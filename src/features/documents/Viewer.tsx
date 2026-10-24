import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ErrorState, Loading, Sheet, Spinner } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { useFileUrl } from '../../hooks/useFileUrl';
import { getDocument, getPages, repairPage } from '../../services/library';
import { runOcr } from '../../services/ocr';
import { getSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { useBackHandler } from '../../app/backStack';
import { tokenize, normalize } from '../../domain/search';
import { ExportSheet } from '../export/ExportSheet';

/** Page viewer: swipe between pages, pinch/double-tap zoom, fit-to-width, OCR text and search highlights. */
export default function Viewer() {
  const { id = '', index = '0' } = useParams();
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const nav = useNavigate();
  const fb = useFeedback();
  const doc = useLive(() => getDocument(id), [id]);
  const pages = useLive(async () => (await getPages(id)).filter((p) => p.accepted), [id]);
  const [i, setI] = useState(Number(index) || 0);
  const list = pages.data ?? [];
  const page = list[Math.min(i, Math.max(0, list.length - 1))];
  const url = useFileUrl(page?.processedPath);
  const [repairing, setRepairing] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [chrome, setChrome] = useState(true);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist: number; startScale: number; startX: number; startY: number; mid: { x: number; y: number }; swipeX: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  useBackHandler(() => nav(-1), true);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.loading]);

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    window.history.replaceState(window.history.state, '', `/doc/${id}/view/${i}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  }, [i, id, q]);

  // Pages with a missing processed image (interrupted edit/restore) are rebuilt from the original.
  useEffect(() => {
    if (page && !page.processedPath && !repairing) {
      setRepairing(true);
      void repairPage(page.id).finally(() => setRepairing(false));
    }
  }, [page, repairing]);

  const fit = useMemo(() => {
    if (!page || !stage.w) return { w: 0, h: 0 };
    const pw = page.outWidth || 1000;
    const ph = page.outHeight || 1400;
    const s = Math.min((stage.w - 24) / pw, (stage.h - 24) / ph);
    return { w: pw * s, h: ph * s };
  }, [page, stage]);

  const highlights = useMemo(() => {
    if (!q || !page?.ocrWords) return [];
    const terms = tokenize(q);
    return page.ocrWords.filter((w) => terms.some((t) => normalize(w.t).includes(t)));
  }, [q, page]);

  if (pages.loading || doc.loading) return <Loading />;
  if (!doc.data || !list.length)
    return <ErrorState title="Nothing to show" message="This document has no pages." action={<button className="btn btn-primary" onClick={() => nav(-1)}>Back</button>} />;

  const clampView = (v: { scale: number; x: number; y: number }) => {
    const scale = Math.min(6, Math.max(1, v.scale));
    const maxX = Math.max(0, (fit.w * scale - stage.w) / 2 + 40);
    const maxY = Math.max(0, (fit.h * scale - stage.h) / 2 + 40);
    return { scale, x: Math.min(maxX, Math.max(-maxX, v.x)), y: Math.min(maxY, Math.max(-maxY, v.y)) };
  };
  const go = (d: number) => setI((x) => Math.min(list.length - 1, Math.max(0, x + d)));

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    const mid = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 } : pts[0];
    gesture.current = {
      startDist: pts.length === 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      startScale: view.scale,
      startX: view.x,
      startY: view.y,
      mid,
      swipeX: e.clientX,
      moved: false,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (pts.length === 2 && g.startDist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setView(clampView({ scale: g.startScale * (d / g.startDist), x: g.startX, y: g.startY }));
      g.moved = true;
    } else if (pts.length === 1) {
      const dx = pts[0].x - g.mid.x;
      const dy = pts[0].y - g.mid.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (view.scale > 1.02) setView(clampView({ scale: view.scale, x: g.startX + dx, y: g.startY + dy }));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (!g || pointers.current.size > 0) return;
    const dx = e.clientX - g.swipeX;
    if (view.scale <= 1.02 && Math.abs(dx) > 60) go(dx < 0 ? 1 : -1);
    else if (!g.moved) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        setView(view.scale > 1.05 ? { scale: 1, x: 0, y: 0 } : clampView({ scale: 2.5, x: (stage.w / 2 - e.nativeEvent.offsetX) * 1.5, y: 0 }));
        lastTap.current = 0;
      } else {
        lastTap.current = now;
        setTimeout(() => {
          if (lastTap.current === now) setChrome((c) => !c);
        }, 290);
      }
    }
    gesture.current = null;
  };

  const fitWidth = () => {
    const s = (stage.w - 8) / fit.w;
    setView(clampView({ scale: Math.max(1, s), x: 0, y: Math.max(0, (fit.h * s - stage.h) / 2) }));
  };

  return (
    <div className="viewer">
      <div
        className="vstage"
        ref={stageRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={(e) => setView(clampView({ ...view, scale: view.scale * (e.deltaY < 0 ? 1.1 : 0.9) }))}
        role="img"
        aria-label={`Page ${i + 1} of ${list.length}`}
      >
        {fit.w > 0 && (
          <div
            className="vpage"
            style={{
              width: fit.w,
              height: fit.h,
              transform: `translate(${view.x - (fit.w * view.scale) / 2}px, ${view.y - (fit.h * view.scale) / 2}px) scale(${view.scale})`,
              transition: gesture.current ? 'none' : 'transform 160ms var(--ease)',
            }}
          >
            {url ? <img src={url} alt="" draggable={false} /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Spinner /></div>}
            {highlights.map((w, k) => (
              <span key={k} className="hl" style={{ left: `${w.x0 * 100}%`, top: `${w.y0 * 100}%`, width: `${(w.x1 - w.x0) * 100}%`, height: `${(w.y1 - w.y0) * 100}%` }} />
            ))}
          </div>
        )}
      </div>

      {chrome && (
        <>
          <div className="vbar top glass-strong">
            <button className="icon-btn" onClick={() => nav(-1)} aria-label="Close viewer">
              <Icon name="back" />
            </button>
            <div className="topbar-title">{doc.data.title}</div>
            <span className="mono small muted" style={{ padding: '0 6px' }} aria-live="polite">
              {i + 1}/{list.length}
            </span>
            <button className="icon-btn" onClick={() => setTextOpen(true)} aria-label="Show recognised text">
              <Icon name="text" />
            </button>
            <button className="icon-btn" onClick={() => setShareOpen(true)} aria-label="Share this page">
              <Icon name="share" />
            </button>
          </div>
          <div className="vbar bottom glass-strong">
            <button className="icon-btn" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous page">
              <Icon name="back" />
            </button>
            <button className="icon-btn" onClick={() => setView(clampView({ ...view, scale: view.scale / 1.4 }))} aria-label="Zoom out">
              <Icon name="zoomOut" />
            </button>
            <button className="icon-btn" onClick={fitWidth} aria-label="Fit to width">
              <Icon name="fit" />
            </button>
            <button className="icon-btn" onClick={() => setView(clampView({ ...view, scale: view.scale * 1.4 }))} aria-label="Zoom in">
              <Icon name="zoomIn" />
            </button>
            <button className="icon-btn" onClick={() => nav(`/doc/${id}/edit/${page.id}`)} aria-label="Edit page">
              <Icon name="crop" />
            </button>
            <button className="icon-btn" onClick={() => nav(`/doc/${id}/markup/${page.id}`)} aria-label="Sign or annotate page">
              <Icon name="pen" />
            </button>
            <button className="icon-btn" onClick={() => go(1)} disabled={i >= list.length - 1} aria-label="Next page">
              <Icon name="chevronRight" />
            </button>
          </div>
        </>
      )}

      <Sheet open={textOpen} onClose={() => setTextOpen(false)} title={`Text · page ${i + 1}`}>
        {page.ocrStatus === 'done' && page.ocrText ? (
          <div className="stack">
            <div className="ocr-text selectable">{page.ocrText}</div>
            <button
              className="btn btn-secondary btn-block"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(page.ocrText ?? '');
                  fb.toast('Copied', 'success');
                } catch {
                  fb.toast('Select the text and copy it manually.', 'error');
                }
              }}
            >
              <Icon name="copy" /> Copy text
            </button>
            <p className="tiny muted">Recognised on this device ({page.ocrLanguage}). Results can contain mistakes, especially for handwriting, tables or low-quality scans.</p>
          </div>
        ) : page.ocrStatus === 'running' || page.ocrStatus === 'queued' ? (
          <div className="row" style={{ padding: 16 }}>
            <Spinner /> Recognising…
          </div>
        ) : (
          <div className="stack">
            <p className="muted">{page.ocrStatus === 'done' ? 'No text was found on this page.' : page.ocrStatus === 'failed' ? 'Text recognition failed for this page.' : 'Text hasn’t been recognised yet.'}</p>
            <button
              className="btn btn-primary btn-block"
              onClick={() => {
                void runOcr(id, getSettings().ocrLanguages, [page.id]).catch((e) => fb.error(e));
              }}
            >
              <Icon name="ocr" /> Recognise this page
            </button>
          </div>
        )}
      </Sheet>
      <ExportSheet open={shareOpen} onClose={() => setShareOpen(false)} doc={doc.data} pages={list} initialRange={String(i + 1)} />
    </div>
  );
}
