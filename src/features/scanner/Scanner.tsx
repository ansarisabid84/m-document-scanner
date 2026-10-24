import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { useFeedback } from '../../app/feedback';
import { useBackHandler } from '../../app/backStack';
import { updateSettings, useSettings } from '../../infrastructure/settings';
import { isNative, isIOS } from '../../infrastructure/platform';
import { success, tap } from '../../infrastructure/haptics';
import { useLive } from '../../hooks/useLive';
import { useFileUrl } from '../../hooks/useFileUrl';
import { acceptPage, addImagePage, createDraft, deletePage, discardDraft, getDocument, getPage, getPages, updatePage } from '../../services/library';
import { canvasToBlob, createCanvas, detect, grabFrame } from '../../imaging/engine';
import { quadDelta } from '../../domain/geometry';
import type { Page, PageEdits, Quad } from '../../domain/models';
import { PageEditor } from '../editor/PageEditor';

type CamState = 'explain' | 'starting' | 'live' | 'denied' | 'unavailable' | 'paused';
const STABLE_FRAMES = 7;
const DETECT_MS = 140;

export default function Scanner() {
  const nav = useNavigate();
  const fb = useFeedback();
  const settings = useSettings();
  const [params] = useSearchParams();
  const addTo = params.get('add'); // existing document to append to
  const [docId, setDocId] = useState<string | null>(params.get('doc') ?? addTo);
  const [cam, setCam] = useState<CamState>(settings.cameraExplained ? 'starting' : 'explain');
  const [camError, setCamError] = useState('');
  const [quad, setQuad] = useState<Quad | null>(null);
  const [stable, setStable] = useState(0);
  const [torch, setTorch] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(0);
  const [review, setReview] = useState<Page | null>(null);
  const [savingReview, setSavingReview] = useState(false);
  const [baselineCount] = useState<Promise<number>>(() => (addTo ? getPages(addTo).then((p) => p.length) : Promise.resolve(0)));
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCanvas = useRef<HTMLCanvasElement>(createCanvas(1, 1));
  const lastQuad = useRef<{ quad: Quad; conf: number } | null>(null);
  const stableRef = useRef(0);
  const cooldownUntil = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [box, setBox] = useState({ w: window.innerWidth, h: window.innerHeight });

  const pages = useLive(async () => (docId ? (await getPages(docId)).filter((p) => p.accepted) : []), [docId]);
  const sessionPages = pages.data ?? [];
  const lastPage = sessionPages[sessionPages.length - 1];
  const lastThumb = useFileUrl(lastPage?.thumbPath);

  /* ─────────────── camera lifecycle ─────────────── */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorch(false);
  }, []);

  const startStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam('unavailable');
      setCamError('Live camera isn’t supported here.');
      return;
    }
    setCam('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      setTorchAvailable(!!caps.torch);
      if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      track.addEventListener('ended', () => {
        setCam('unavailable');
        setCamError('The camera was interrupted (another app or a call may be using it).');
      });
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      setCam('live');
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') setCam('denied');
      else {
        setCam('unavailable');
        setCamError(name === 'NotReadableError' ? 'The camera is being used by another app. Close it and try again.' : 'No usable camera was found.');
      }
    }
  }, []);

  useEffect(() => {
    if (cam === 'starting' && !streamRef.current && !review) void startStream();
  }, [cam, startStream, review]);

  useEffect(() => () => stopStream(), [stopStream]);

  // Release the camera while backgrounded or while reviewing a page.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (streamRef.current) {
          stopStream();
          setCam('paused');
        }
      } else if (cam === 'paused' && !review) setCam('starting');
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [cam, review, stopStream]);

  useEffect(() => {
    if (review && streamRef.current) {
      stopStream();
      setCam('paused');
    } else if (!review && cam === 'paused' && !document.hidden) setCam('starting');
  }, [review]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);

  /* ─────────────── capture ─────────────── */
  const ensureDoc = useCallback(async () => {
    if (docId) return docId;
    const d = await createDraft('camera');
    setDocId(d.id);
    return d.id;
  }, [docId]);

  const handleNewPage = useCallback(
    async (page: Page) => {
      if (settings.reviewAfterCapture) setReview(page);
      else success();
    },
    [settings.reviewAfterCapture],
  );

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || capturing || cam !== 'live' || !v.videoWidth) return;
    setCapturing(true);
    tap('medium');
    setFlash((f) => f + 1);
    try {
      const c = createCanvas(v.videoWidth, v.videoHeight);
      c.getContext('2d')!.drawImage(v, 0, 0);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.93);
      c.width = c.height = 0;
      const id = await ensureDoc();
      const det = lastQuad.current && lastQuad.current.conf > 0.55 ? lastQuad.current.quad : undefined;
      const page = await addImagePage(id, blob, { filter: settings.defaultFilter, detectEdges: !det, quad: det, accepted: !settings.reviewAfterCapture });
      cooldownUntil.current = Date.now() + 1800;
      stableRef.current = 0;
      setStable(0);
      await handleNewPage(page);
    } catch (e) {
      fb.error(e, 'Could not capture this page.');
    } finally {
      setCapturing(false);
    }
  }, [cam, capturing, ensureDoc, fb, handleNewPage, settings.defaultFilter, settings.reviewAfterCapture]);

  /* ─────────────── live edge detection ─────────────── */
  useEffect(() => {
    if (cam !== 'live' || review) return;
    let alive = true;
    let busy = false;
    const loop = setInterval(async () => {
      const v = videoRef.current;
      if (!alive || busy || !v || v.readyState < 2) return;
      busy = true;
      try {
        const frame = grabFrame(v, 320, frameCanvas.current);
        const det = frame ? await detect(frame) : null;
        if (!alive) return;
        if (det && det.confidence > 0.5) {
          const prev = lastQuad.current?.quad;
          const moved = prev ? quadDelta(prev, det.quad) : 1;
          // Smooth jitter, snap on large moves.
          const smoothed = prev && moved < 0.05 ? (det.quad.map((p, i) => ({ x: prev[i].x * 0.5 + p.x * 0.5, y: prev[i].y * 0.5 + p.y * 0.5 })) as Quad) : det.quad;
          lastQuad.current = { quad: smoothed, conf: det.confidence };
          stableRef.current = moved < 0.018 ? stableRef.current + 1 : 0;
          setQuad(smoothed);
        } else {
          lastQuad.current = null;
          stableRef.current = 0;
          setQuad(null);
        }
        setStable(stableRef.current);
      } catch {
        /* skip frame */
      } finally {
        busy = false;
      }
    }, DETECT_MS);
    return () => {
      alive = false;
      clearInterval(loop);
    };
  }, [cam, review]);

  useEffect(() => {
    if (settings.autoCapture && stable >= STABLE_FRAMES && !capturing && Date.now() > cooldownUntil.current && !review) void capture();
  }, [stable, settings.autoCapture, capturing, capture, review]);

  /* ─────────────── fallbacks: system camera / import ─────────────── */
  const systemCamera = async () => {
    try {
      const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 92, correctOrientation: true, saveToGallery: false });
      if (!photo.webPath) return;
      const blob = await (await fetch(photo.webPath)).blob();
      const id = await ensureDoc();
      const page = await addImagePage(id, blob, { filter: settings.defaultFilter, detectEdges: true, accepted: !settings.reviewAfterCapture });
      await handleNewPage(page);
    } catch (e) {
      if (!String((e as Error)?.message).toLowerCase().includes('cancel')) fb.error(e, 'The system camera could not be opened.');
    }
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const id = await ensureDoc();
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    if (!list.length) return fb.toast('Choose image files here. Use Import on the Home screen for PDFs.', 'error');
    let last: Page | null = null;
    for (const f of list) {
      try {
        last = await addImagePage(id, f, { filter: settings.defaultFilter, detectEdges: true, accepted: list.length > 1 || !settings.reviewAfterCapture });
      } catch (e) {
        fb.error(e, `Could not import ${f.name}`);
      }
    }
    if (list.length === 1 && last) await handleNewPage(last);
    else if (last) fb.toast(`Added ${list.length} images`, 'success');
  };

  /* ─────────────── finish / exit ─────────────── */
  const finish = async () => {
    if (!docId) return nav(-1);
    const accepted = (await getPages(docId)).filter((p) => p.accepted);
    if (addTo) {
      const before = await baselineCount;
      if (accepted.length > before) fb.toast(`Added ${accepted.length - before} page${accepted.length - before === 1 ? '' : 's'}`, 'success');
      return nav(`/doc/${addTo}`, { replace: true });
    }
    if (!accepted.length) {
      await discardDraft(docId);
      return nav(-1);
    }
    nav(`/save/${docId}`, { replace: true });
  };

  const close = async () => {
    if (addTo) return finish();
    if (docId && sessionPages.length) {
      const discard = await fb.confirm({
        title: 'Discard this scan?',
        message: `You’ve captured ${sessionPages.length} page${sessionPages.length === 1 ? '' : 's'}. Discarding deletes them.`,
        confirmLabel: 'Discard',
        cancelLabel: 'Keep scanning',
        destructive: true,
      });
      if (!discard) return;
      await discardDraft(docId);
    } else if (docId) {
      const d = await getDocument(docId);
      if (d?.draft) await discardDraft(docId);
    }
    nav(-1);
  };

  useBackHandler(() => void close(), !review);

  /* ─────────────── review overlay actions ─────────────── */
  const keepReviewed = async (edits: PageEdits) => {
    if (!review) return;
    setSavingReview(true);
    try {
      const changed = JSON.stringify(edits) !== JSON.stringify(review.edits);
      if (changed) await updatePage(review.id, { edits });
      await acceptPage(review.id);
      success();
      setReview(null);
    } catch (e) {
      fb.error(e, 'Could not save this page.');
    } finally {
      setSavingReview(false);
    }
  };
  const retake = async () => {
    if (!review) return;
    await deletePage(review.id);
    setReview(null);
  };

  /* ─────────────── overlay geometry (video uses object-fit: cover) ─────────────── */
  const v = videoRef.current;
  const vw = v?.videoWidth || 1;
  const vh = v?.videoHeight || 1;
  const scale = Math.max(box.w / vw, box.h / vh);
  const ox = (box.w - vw * scale) / 2;
  const oy = (box.h - vh * scale) / 2;
  const screenPts = quad?.map((p) => `${ox + p.x * vw * scale},${oy + p.y * vh * scale}`).join(' ');
  const steady = stable >= 3;
  const hint =
    cam !== 'live'
      ? ''
      : capturing
        ? 'Capturing…'
        : !quad
          ? 'Point at a document — or tap the shutter'
          : settings.autoCapture
            ? steady
              ? 'Hold steady…'
              : 'Document found'
            : 'Document found — tap to capture';

  return (
    <div className="scanner">
      <video ref={videoRef} playsInline muted autoPlay aria-label="Camera preview" style={{ opacity: cam === 'live' ? 1 : 0 }} />
      {cam === 'live' && quad && (
        <svg className="overlay" viewBox={`0 0 ${box.w} ${box.h}`} aria-hidden="true">
          <polygon
            points={screenPts}
            fill={steady ? 'rgba(126,224,184,0.22)' : 'rgba(140,155,255,0.16)'}
            stroke={steady ? '#7EE0B8' : '#A7B2FF'}
            strokeWidth={3}
            strokeLinejoin="round"
            style={{ transition: 'all 140ms linear' }}
          />
        </svg>
      )}
      {flash > 0 && <div key={flash} className="flash-overlay" />}

      <div className="bar">
        <button className="cam-btn" onClick={() => void close()} aria-label="Close scanner">
          <Icon name="close" />
        </button>
        <div className="spacer" />
        {torchAvailable && (
          <button
            className={`cam-btn ${torch ? 'on' : ''}`}
            aria-label={torch ? 'Turn torch off' : 'Turn torch on'}
            aria-pressed={torch}
            onClick={async () => {
              const t = streamRef.current?.getVideoTracks()[0];
              try {
                await t?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
                setTorch(!torch);
              } catch {
                setTorchAvailable(false);
              }
            }}
          >
            <Icon name={torch ? 'flash' : 'flashOff'} />
          </button>
        )}
        <button className="cam-pill" aria-pressed={settings.reviewAfterCapture} onClick={() => void updateSettings({ reviewAfterCapture: !settings.reviewAfterCapture })} aria-label="Review each page after capture">
          <Icon name="crop" size={16} /> Review
        </button>
        <button className="cam-pill" aria-pressed={settings.autoCapture} onClick={() => void updateSettings({ autoCapture: !settings.autoCapture })} aria-label="Automatic capture">
          <Icon name="sparkles" size={16} /> Auto
        </button>
      </div>
      {hint && (
        <div className="cam-hint" aria-live="polite">
          {hint}
        </div>
      )}

      {cam === 'explain' && (
        <div className="cam-message">
          <span className="row-icon" style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(255,255,255,.12)', color: '#fff' }}>
            <Icon name="camera" />
          </span>
          <h2 style={{ fontSize: '1.3rem' }}>Allow camera access</h2>
          <p>Document Scanner uses the camera only while this screen is open. Pages are processed on your phone and never uploaded.</p>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              void updateSettings({ cameraExplained: true });
              setCam('starting');
            }}
          >
            Continue
          </button>
          <button className="btn btn-ghost btn-block" style={{ color: '#fff' }} onClick={() => fileInput.current?.click()}>
            Import photos instead
          </button>
        </div>
      )}
      {(cam === 'starting' || cam === 'paused') && !review && (
        <div className="cam-message" style={{ background: 'transparent' }}>
          <Spinner label="Starting camera" />
        </div>
      )}
      {(cam === 'denied' || cam === 'unavailable') && (
        <div className="cam-message" role="alert">
          <span className="row-icon danger" style={{ width: 56, height: 56, borderRadius: 18 }}>
            <Icon name="camera" />
          </span>
          <h2 style={{ fontSize: '1.3rem' }}>{cam === 'denied' ? 'Camera access is off' : 'Camera unavailable'}</h2>
          <p>
            {cam === 'denied'
              ? `To scan with the live camera, allow camera access for Document Scanner in your phone’s ${isIOS ? 'Settings › Privacy & Security › Camera' : 'Settings › Apps › Document Scanner › Permissions'}. You can still import photos and PDFs.`
              : camError}
          </p>
          {cam === 'unavailable' && (
            <button className="btn btn-primary btn-block" onClick={() => setCam('starting')}>
              <Icon name="refresh" /> Try again
            </button>
          )}
          {isNative && (
            <button className="btn btn-secondary btn-block" onClick={() => void systemCamera()}>
              <Icon name="camera" /> Use system camera
            </button>
          )}
          <button className="btn btn-secondary btn-block" onClick={() => fileInput.current?.click()}>
            <Icon name="image" /> Import photos
          </button>
        </div>
      )}

      <div className="bar bottom">
        <button className="cam-btn" style={{ width: 56, height: 56, borderRadius: 16 }} onClick={() => fileInput.current?.click()} aria-label="Import images">
          <Icon name="image" />
        </button>
        <button className="shutter" onClick={() => void capture()} disabled={cam !== 'live' || capturing} aria-label="Capture page">
          {capturing && <span className="ring" />}
        </button>
        {sessionPages.length > 0 ? (
          <button className="cam-thumb" onClick={() => void finish()} aria-label={`Done, ${sessionPages.length} pages`}>
            {lastThumb && <img src={lastThumb} alt="" />}
            <span className="count">{sessionPages.length}</span>
          </button>
        ) : (
          <span style={{ width: 56 }} />
        )}
      </div>
      {sessionPages.length > 0 && (
        <button className="btn btn-primary" style={{ position: 'absolute', right: 20, bottom: 'calc(var(--safe-bottom) + 112px)', zIndex: 3 }} onClick={() => void finish()}>
          Done <Icon name="chevronRight" size={18} />
        </button>
      )}

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => void importFiles(e.target.files).finally(() => (e.target.value = ''))} />

      {review && (
        <PageEditor
          key={review.id}
          page={review}
          mode="review"
          busy={savingReview}
          onConfirm={(ed) => void keepReviewed(ed)}
          onRetake={() => void retake()}
          onCancel={async () => {
            // Leaving review without keeping = retake (the original is discarded only if never accepted).
            const p = await getPage(review.id);
            if (p && !p.accepted) await deletePage(p.id);
            setReview(null);
          }}
        />
      )}
    </div>
  );
}
