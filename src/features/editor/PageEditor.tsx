import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Segmented, Spinner } from '../../components/ui';
import { FILTER_LABELS, type FilterType, type Page, type PageEdits, type Point, type Quad } from '../../domain/models';
import { FULL_QUAD, clampQuad, isUsableQuad } from '../../domain/geometry';
import { useFileUrl } from '../../hooks/useFileUrl';
import { useBackHandler } from '../../app/backStack';
import { fileStore } from '../../infrastructure/fileStore';
import { decodeBlob, detect, imageToCanvas, renderEdits, scaledCanvas } from '../../imaging/engine';
import type { RGBAImage } from '../../imaging/warp';

const FILTERS: FilterType[] = ['original', 'auto', 'color', 'grayscale', 'bw'];
const PREVIEW_DIM = 1400;

type Tab = 'crop' | 'filter' | 'adjust';

/**
 * Non-destructive page editor (crop/perspective, rotation, filters, brightness/contrast).
 * Nothing is written until the user confirms; the original capture is always kept.
 */
export function PageEditor({
  page,
  mode,
  busy,
  onConfirm,
  onCancel,
  onRetake,
}: {
  page: Page;
  mode: 'review' | 'edit';
  busy?: boolean;
  onConfirm: (edits: PageEdits) => void;
  onCancel: () => void;
  onRetake?: () => void;
}) {
  const [edits, setEdits] = useState<PageEdits>(page.edits);
  const [history, setHistory] = useState<PageEdits[]>([]);
  const [tab, setTab] = useState<Tab>(mode === 'review' && !page.edits.quad ? 'crop' : mode === 'review' ? 'crop' : 'filter');
  const originalUrl = useFileUrl(page.originalPath);
  const sourceRef = useRef<RGBAImage | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [renderErr, setRenderErr] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  useBackHandler(onCancel, true);

  useEffect(() => {
    let alive = true;
    fileStore
      .read(page.originalPath)
      .then((b) => decodeBlob(b, PREVIEW_DIM))
      .then((img) => {
        if (!alive) return;
        sourceRef.current = img;
        setSourceReady(true);
      })
      .catch(() => alive && setRenderErr('The original image could not be opened.'));
    return () => {
      alive = false;
    };
  }, [page.originalPath]);

  const commit = useCallback((next: PageEdits) => {
    setEdits((cur) => {
      setHistory((h) => [...h.slice(-30), cur]);
      return next;
    });
  }, []);

  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setEdits(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  // Render preview for filter/adjust tabs (debounced).
  const renderKey = JSON.stringify({ q: edits.quad, r: edits.rotation, f: edits.filter, b: edits.brightness, c: edits.contrast });
  useEffect(() => {
    if (tab === 'crop' || !sourceReady || !sourceRef.current) return;
    let alive = true;
    setRendering(true);
    const t = setTimeout(async () => {
      try {
        const src = sourceRef.current!;
        const out = await renderEdits({ data: src.data.slice(), width: src.width, height: src.height }, edits, PREVIEW_DIM);
        if (!alive || !canvasRef.current) return;
        const c = canvasRef.current;
        c.width = out.width;
        c.height = out.height;
        c.getContext('2d')!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
        setRenderErr(null);
      } catch {
        if (alive) setRenderErr('Preview failed. The device may be low on memory.');
      } finally {
        if (alive) setRendering(false);
      }
    }, 90);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [renderKey, tab, sourceReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const quad = edits.quad ?? FULL_QUAD;
  const quadOk = isUsableQuad(quad);

  const autoDetect = async () => {
    if (!sourceRef.current) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      const c = imageToCanvas(sourceRef.current);
      const small = scaledCanvas(c, 360);
      const d = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
      const det = await detect({ data: d.data, width: d.width, height: d.height });
      if (det) commit({ ...edits, quad: det.quad });
      else setDetectMsg('No clear edges found — drag the corners to fit the page.');
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label={mode === 'review' ? 'Review page' : 'Edit page'}>
      <div className="bar">
        <button className="icon-btn" onClick={onCancel} aria-label={mode === 'review' ? 'Back to camera' : 'Cancel editing'}>
          <Icon name="close" />
        </button>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 650 }}>{mode === 'review' ? 'Review page' : 'Edit page'}</div>
        <button className="icon-btn" onClick={undo} disabled={!history.length} aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={() => commit({ ...edits, rotation: (((edits.rotation + 270) % 360) as PageEdits['rotation']) })} aria-label="Rotate left">
          <Icon name="rotateCcw" />
        </button>
        <button className="icon-btn" onClick={() => commit({ ...edits, rotation: (((edits.rotation + 90) % 360) as PageEdits['rotation']) })} aria-label="Rotate right">
          <Icon name="rotateCw" />
        </button>
      </div>

      <div className="stage">
        {tab === 'crop' ? (
          originalUrl ? (
            <CropStage url={originalUrl} quad={quad} onChange={(q) => setEdits((e) => ({ ...e, quad: q }))} onCommit={(prev) => setHistory((h) => [...h.slice(-30), { ...edits, quad: prev }])} />
          ) : (
            <Spinner />
          )
        ) : (
          <div className="stage-inner" style={{ display: 'grid', placeItems: 'center', height: '100%', width: '100%' }}>
            <canvas ref={canvasRef} aria-label="Edited page preview" style={{ maxHeight: '100%', maxWidth: '100%' }} />
            {rendering && (
              <div style={{ position: 'absolute', top: 10, right: 10 }}>
                <Spinner label="Updating preview" />
              </div>
            )}
          </div>
        )}
        {renderErr && (
          <div className="notice danger" style={{ position: 'absolute', bottom: 12, left: 16, right: 16, color: '#fff' }}>
            <Icon name="alert" /> {renderErr}
          </div>
        )}
      </div>

      <div className="tools">
        {tab === 'crop' && (
          <>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button className="chip" onClick={() => void autoDetect()} disabled={detecting || !sourceReady}>
                {detecting ? <Spinner /> : <Icon name="wand" />} Auto-detect
              </button>
              <button className="chip" onClick={() => commit({ ...edits, quad: null })}>
                <Icon name="fit" /> Full page
              </button>
              <button className="chip" onClick={() => commit({ ...edits, quad: page.edits.quad })}>
                <Icon name="refresh" /> Reset
              </button>
            </div>
            <p className="small muted" style={{ textAlign: 'center', minHeight: 20 }} aria-live="polite">
              {!quadOk ? 'Corners overlap — drag them back into a four-sided shape.' : detectMsg ?? (edits.rotation ? `Will be rotated ${edits.rotation}° · drag corners to adjust` : 'Drag the corners to the edges of the page')}
            </p>
          </>
        )}
        {tab === 'filter' && (
          <div className="chips" role="group" aria-label="Filters">
            {FILTERS.map((f) => (
              <button key={f} className="chip" aria-pressed={edits.filter === f} onClick={() => commit({ ...edits, filter: f })}>
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>
        )}
        {tab === 'adjust' && (
          <div className="stack" style={{ gap: 4 }}>
            {(['brightness', 'contrast'] as const).map((k) => (
              <label key={k} className="slider-row">
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
                <input type="range" min={-100} max={100} step={1} value={edits[k]} onChange={(e) => setEdits({ ...edits, [k]: Number(e.target.value) })} onPointerUp={() => setHistory((h) => [...h, edits])} aria-label={k} />
                <span className="mono small" style={{ textAlign: 'right' }}>{edits[k] > 0 ? `+${edits[k]}` : edits[k]}</span>
              </label>
            ))}
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'center', color: 'inherit' }} onClick={() => commit({ ...edits, brightness: 0, contrast: 0 })}>
              Reset adjustments
            </button>
          </div>
        )}

        <Segmented<Tab>
          label="Editing tool"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'crop', label: 'Crop' },
            { value: 'filter', label: 'Filters' },
            { value: 'adjust', label: 'Adjust' },
          ]}
        />
        <div className="row">
          {onRetake ? (
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onRetake} disabled={busy}>
              <Icon name="camera" /> Retake
            </button>
          ) : (
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button className="btn btn-primary" style={{ flex: 1.4 }} disabled={busy || !quadOk} onClick={() => onConfirm(edits)}>
            {busy ? <Spinner label="Saving" /> : <Icon name="check" />} {mode === 'review' ? 'Keep page' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Original image with draggable perspective corners and a magnifier loupe. */
function CropStage({ url, quad, onChange, onCommit }: { url: string; quad: Quad; onChange: (q: Quad) => void; onCommit: (prev: Quad) => void }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<{ i: number; start: Quad } | null>(null);
  const [kbd, setKbd] = useState<number | null>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => setBox({ w: img.clientWidth, h: img.clientHeight }));
    ro.observe(img);
    return () => ro.disconnect();
  }, [url]);

  const pts = useMemo(() => quad.map((p) => ({ x: p.x * box.w, y: p.y * box.h })), [quad, box]);

  const move = (i: number, clientX: number, clientY: number) => {
    const r = imgRef.current!.getBoundingClientRect();
    const p: Point = { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
    const next = [...quad] as Quad;
    next[i] = p;
    onChange(clampQuad(next));
  };

  const nudge = (i: number, dx: number, dy: number) => {
    const next = [...quad] as Quad;
    next[i] = { x: next[i].x + dx, y: next[i].y + dy };
    onChange(clampQuad(next));
  };

  const active = drag?.i ?? null;
  const loupeAt = active !== null ? pts[active] : null;
  const names = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

  return (
    <div className="stage-inner" style={{ touchAction: 'none' }}>
      <img ref={imgRef} src={url} alt="Captured page" draggable={false} onLoad={(e) => setBox({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })} style={{ maxHeight: 'calc(100dvh - 330px)' }} />
      {box.w > 0 && (
        <svg className="crop-svg" viewBox={`0 0 ${box.w} ${box.h}`} style={{ width: box.w, height: box.h }}>
          <defs>
            <mask id="crop-mask">
              <rect width={box.w} height={box.h} fill="#fff" />
              <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="#000" />
            </mask>
          </defs>
          <rect width={box.w} height={box.h} fill="rgba(5,8,18,0.55)" mask="url(#crop-mask)" />
          <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(140,155,255,0.12)" stroke="#8C9BFF" strokeWidth={2.5} strokeLinejoin="round" />
          {pts.map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r={22}
                fill="transparent"
                style={{ cursor: 'grab', touchAction: 'none' }}
                tabIndex={0}
                role="slider"
                aria-label={`Move ${names[i]} corner`}
                aria-valuetext={`${Math.round(quad[i].x * 100)}%, ${Math.round(quad[i].y * 100)}%`}
                onFocus={() => setKbd(i)}
                onBlur={() => setKbd(null)}
                onKeyDown={(e) => {
                  const s = e.shiftKey ? 0.02 : 0.005;
                  const map: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] };
                  if (map[e.key]) {
                    e.preventDefault();
                    nudge(i, ...map[e.key]);
                  }
                }}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture(e.pointerId);
                  setDrag({ i, start: quad });
                }}
                onPointerMove={(e) => drag?.i === i && move(i, e.clientX, e.clientY)}
                onPointerUp={() => {
                  if (drag) onCommit(drag.start);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
              />
              <circle cx={p.x} cy={p.y} r={active === i || kbd === i ? 13 : 10} className="crop-handle" pointerEvents="none" />
            </g>
          ))}
        </svg>
      )}
      {loupeAt && (
        <div
          className="loupe"
          aria-hidden="true"
          style={{
            left: Math.min(Math.max(loupeAt.x - 52, -20), box.w - 84),
            top: loupeAt.y - 140 < -40 ? loupeAt.y + 36 : loupeAt.y - 140,
            backgroundImage: `url(${url})`,
            backgroundSize: `${box.w * 2.5}px ${box.h * 2.5}px`,
            backgroundPosition: `${-(loupeAt.x * 2.5 - 52)}px ${-(loupeAt.y * 2.5 - 52)}px`,
          }}
        />
      )}
    </div>
  );
}
