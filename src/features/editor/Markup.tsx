import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Preferences } from '@capacitor/preferences';
import { Icon, type IconName } from '../../components/Icon';
import { ErrorState, Loading, Sheet, Spinner } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { getPage, updatePage } from '../../services/library';
import { useFeedback } from '../../app/feedback';
import { useBackHandler } from '../../app/backStack';
import { fileStore } from '../../infrastructure/fileStore';
import { uuid } from '../../infrastructure/platform';
import { MAX_ORIGINAL_DIM, decodeBlob, drawMarkup, renderEdits } from '../../imaging/engine';
import type { MarkupOp, Page } from '../../domain/models';

type Tool = 'pen' | 'highlight' | 'text' | 'date' | 'signature' | 'redact' | 'erase';
const TOOLS: { id: Tool; icon: IconName; label: string }[] = [
  { id: 'pen', icon: 'pen', label: 'Pen' },
  { id: 'highlight', icon: 'highlighter', label: 'Highlight' },
  { id: 'text', icon: 'type', label: 'Text' },
  { id: 'date', icon: 'calendar', label: 'Date' },
  { id: 'signature', icon: 'signature', label: 'Sign' },
  { id: 'redact', icon: 'redact', label: 'Redact' },
  { id: 'erase', icon: 'eraser', label: 'Erase' },
];
const INKS = ['#111827', '#1D3FBF', '#B91C1C', '#047857'];
const SIG_KEY = 'signature.v1';

type Strokes = [number, number][][];

function opBounds(op: MarkupOp): { x: number; y: number; w: number; h: number } {
  if (op.kind === 'ink') {
    const xs = op.points.map((p) => p[0]);
    const ys = op.points.map((p) => p[1]);
    const pad = op.width;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (op.kind === 'text') return { x: op.x, y: op.y, w: op.size * op.text.length * 0.6, h: op.size * 1.3 * op.text.split('\n').length };
  return { x: op.x, y: op.y, w: op.w, h: op.h };
}

export default function Markup() {
  const { pageId = '' } = useParams();
  const page = useLive(() => getPage(pageId), [pageId]);
  if (page.loading) return <Loading />;
  if (!page.data) return <ErrorState title="Page not found" />;
  return <MarkupEditor page={page.data} />;
}

function MarkupEditor({ page }: { page: Page }) {
  const nav = useNavigate();
  const fb = useFeedback();
  const baseRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [ops, setOps] = useState<MarkupOp[]>(page.markup);
  const [undone, setUndone] = useState<MarkupOp[][]>([]);
  const [history, setHistory] = useState<MarkupOp[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [ink, setInk] = useState(INKS[0]);
  const [width, setWidth] = useState(0.004);
  const [live, setLive] = useState<MarkupOp | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [signature, setSignature] = useState<{ strokes: Strokes; aspect: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  useBackHandler(() => void leave(), true);

  useEffect(() => {
    void Preferences.get({ key: SIG_KEY }).then(({ value }) => {
      if (value) setSignature(JSON.parse(value));
    });
  }, []);

  // Base = page with current crop/filter but without markup, so annotations stay editable.
  useEffect(() => {
    let alive = true;
    (async () => {
      const img = await decodeBlob(await fileStore.read(page.originalPath), MAX_ORIGINAL_DIM);
      const out = await renderEdits(img, page.edits, 1800);
      if (!alive || !baseRef.current || !inkRef.current) return;
      for (const c of [baseRef.current, inkRef.current]) {
        c.width = out.width;
        c.height = out.height;
      }
      baseRef.current.getContext('2d')!.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
      setReady(true);
    })().catch(() => fb.toast('This page could not be opened for markup.', 'error'));
    return () => {
      alive = false;
    };
  }, [page.originalPath, page.edits]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = inkRef.current;
    if (!c || !ready) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    const all = live ? [...ops, live] : ops;
    drawMarkup(ctx, all, c.width, c.height);
    // Show redaction boxes as dashed outlines while drawing for clarity.
    if (live?.kind === 'redact') {
      ctx.strokeStyle = '#ff5a6a';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 3;
      ctx.strokeRect(live.x * c.width, live.y * c.height, live.w * c.width, live.h * c.height);
      ctx.setLineDash([]);
    }
  }, [ops, live, ready]);

  const push = (next: MarkupOp[]) => {
    setHistory((h) => [...h.slice(-40), ops]);
    setUndone([]);
    setOps(next);
  };
  const undo = () => {
    if (!history.length) return;
    setUndone((u) => [...u, ops]);
    setOps(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!undone.length) return;
    setHistory((h) => [...h, ops]);
    setOps(undone[undone.length - 1]);
    setUndone((u) => u.slice(0, -1));
  };

  const norm = (e: React.PointerEvent) => {
    const r = inkRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const aspect = () => (inkRef.current ? inkRef.current.width / inkRef.current.height : 0.7);

  const down = async (e: React.PointerEvent) => {
    if (!ready) return;
    const p = norm(e);
    (e.target as Element).setPointerCapture(e.pointerId);
    if (tool === 'pen' || tool === 'highlight') {
      setLive({ id: uuid(), kind: 'ink', color: tool === 'highlight' ? '#FFD400' : ink, width: tool === 'highlight' ? 0.022 : width, points: [[p.x, p.y]], highlighter: tool === 'highlight' });
    } else if (tool === 'redact') {
      start.current = p;
      setLive({ id: uuid(), kind: 'redact', x: p.x, y: p.y, w: 0, h: 0 });
    } else if (tool === 'erase') {
      const hit = [...ops].reverse().find((op) => {
        const b = opBounds(op);
        return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      });
      if (hit) push(ops.filter((o) => o.id !== hit.id));
    } else if (tool === 'text' || tool === 'date') {
      const text =
        tool === 'date'
          ? new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
          : await fb.prompt({ title: 'Add text', placeholder: 'Type here', confirmLabel: 'Add' });
      if (text) push([...ops, { id: uuid(), kind: 'text', x: p.x, y: p.y, text, size: 0.028, color: ink }]);
    } else if (tool === 'signature') {
      if (!signature) return setSigOpen(true);
      const w = 0.34;
      const h = (w * aspect()) / signature.aspect;
      push([...ops, { id: uuid(), kind: 'signature', x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h / 2), w, h, strokes: signature.strokes, color: ink }]);
    }
  };
  const move = (e: React.PointerEvent) => {
    if (!live) return;
    const p = norm(e);
    if (live.kind === 'ink') setLive({ ...live, points: [...live.points, [p.x, p.y]] });
    else if (live.kind === 'redact' && start.current) {
      const s = start.current;
      setLive({ ...live, x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
    }
  };
  const up = () => {
    if (!live) return;
    if (live.kind === 'redact' && (live.w < 0.01 || live.h < 0.005)) setLive(null);
    else {
      push([...ops, live]);
      setLive(null);
    }
    start.current = null;
  };

  const dirty = JSON.stringify(ops) !== JSON.stringify(page.markup);
  async function leave() {
    if (dirty && !(await fb.confirm({ title: 'Discard markup changes?', confirmLabel: 'Discard', destructive: true }))) return;
    nav(-1);
  }

  const save = async () => {
    const hasRedaction = ops.some((o) => o.kind === 'redact');
    const newRedaction = ops.filter((o) => o.kind === 'redact').length > page.markup.filter((o) => o.kind === 'redact').length;
    if (newRedaction) {
      const ok = await fb.confirm({
        title: 'Apply redaction?',
        message: (
          <>
            Black boxes are burned into the page image used for viewing, search and every export, and this page’s recognised text is deleted. Exported copies cannot be un-redacted. The original capture stays inside this app so you can undo here later.
          </>
        ),
        confirmLabel: 'Apply redaction',
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await updatePage(page.id, { markup: ops });
      fb.toast(hasRedaction ? 'Saved. Redacted areas are removed from exports.' : 'Markup saved', 'success');
      nav(-1);
    } catch (e) {
      fb.error(e);
      setSaving(false);
    }
  };

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="Sign and annotate">
      <div className="bar">
        <button className="icon-btn" onClick={() => void leave()} aria-label="Close">
          <Icon name="close" />
        </button>
        <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 650 }}>Markup</div>
        <button className="icon-btn" onClick={undo} disabled={!history.length} aria-label="Undo">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" onClick={redo} disabled={!undone.length} aria-label="Redo">
          <Icon name="redo" />
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? <Spinner label="Saving" /> : 'Save'}
        </button>
      </div>
      <div className="stage">
        <div className="stage-inner" style={{ maxHeight: '100%' }}>
          <canvas ref={baseRef} aria-hidden="true" style={{ maxHeight: 'calc(100dvh - 300px)' }} />
          <canvas
            ref={inkRef}
            className="markup-canvas"
            role="application"
            aria-label={`Drawing surface, tool: ${tool}`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', boxShadow: 'none', cursor: tool === 'erase' ? 'not-allowed' : 'crosshair' }}
            onPointerDown={(e) => void down(e)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setLive(null)}
          />
          {!ready && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <Spinner />
            </div>
          )}
        </div>
      </div>
      <div className="tools">
        <p className="small muted" style={{ textAlign: 'center', minHeight: 20 }}>
          {tool === 'redact'
            ? 'Drag over anything you want permanently blacked out.'
            : tool === 'signature'
              ? signature
                ? 'Tap where your signature should go. This is a visual signature, not a certified digital signature.'
                : 'Draw your signature first.'
              : tool === 'erase'
                ? 'Tap an annotation to remove it.'
                : tool === 'text' || tool === 'date'
                  ? 'Tap where the text should go.'
                  : 'Draw with your finger or stylus.'}
        </p>
        {(tool === 'pen' || tool === 'text' || tool === 'date' || tool === 'signature') && (
          <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
            {INKS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={ink === c} onClick={() => setInk(c)} />
            ))}
            {tool === 'pen' &&
              [0.0025, 0.004, 0.007].map((w, i) => (
                <button key={w} className={`icon-btn ${width === w ? 'active' : ''}`} aria-label={['Thin', 'Medium', 'Thick'][i]} aria-pressed={width === w} onClick={() => setWidth(w)} style={{ width: 40, height: 40 }}>
                  <span style={{ width: 6 + i * 5, height: 6 + i * 5, borderRadius: '50%', background: 'currentColor' }} />
                </button>
              ))}
            {tool === 'signature' && signature && (
              <button className="chip" onClick={() => setSigOpen(true)}>
                Redraw
              </button>
            )}
          </div>
        )}
        <div className="chips" role="toolbar" aria-label="Markup tools">
          {TOOLS.map((t) => (
            <button key={t.id} className="chip" aria-pressed={tool === t.id} onClick={() => (setTool(t.id), t.id === 'signature' && !signature && setSigOpen(true))}>
              <Icon name={t.icon} /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <SignaturePad
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        onSave={(sig) => {
          setSignature(sig);
          void Preferences.set({ key: SIG_KEY, value: JSON.stringify(sig) });
          setSigOpen(false);
          setTool('signature');
        }}
      />
    </div>
  );
}

function SignaturePad({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (s: { strokes: Strokes; aspect: number }) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Strokes>([]);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open) setStrokes([]);
  }, [open]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * 2;
    c.height = r.height * 2;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 5;
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const s of strokes) {
      ctx.beginPath();
      s.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height)));
      ctx.stroke();
    }
  }, [strokes, open]);

  const pt = (e: React.PointerEvent): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  /** Crops strokes to their bounding box so placement is tight. */
  const finish = () => {
    const pts = strokes.flat();
    const minX = Math.min(...pts.map((p) => p[0]));
    const maxX = Math.max(...pts.map((p) => p[0]));
    const minY = Math.min(...pts.map((p) => p[1]));
    const maxY = Math.max(...pts.map((p) => p[1]));
    const w = Math.max(0.01, maxX - minX);
    const h = Math.max(0.01, maxY - minY);
    const c = ref.current!;
    const aspect = (w * c.width) / (h * c.height);
    onSave({ strokes: strokes.map((s) => s.map(([x, y]) => [(x - minX) / w, (y - minY) / h] as [number, number])), aspect });
  };

  return (
    <Sheet open={open} onClose={onClose} title="Your signature">
      <div className="stack">
        <canvas
          ref={ref}
          className="sig-pad"
          aria-label="Signature drawing area"
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            drawing.current = true;
            setStrokes((s) => [...s, [pt(e)]]);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = pt(e);
            setStrokes((s) => [...s.slice(0, -1), [...s[s.length - 1], p]]);
          }}
          onPointerUp={() => (drawing.current = false)}
        />
        <p className="tiny muted">Saved only on this device for reuse. A drawn signature is a visual mark — it is not a certified or legally verified e-signature.</p>
        <div className="row">
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStrokes([])}>
            Clear
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} disabled={!strokes.length} onClick={finish}>
            Use signature
          </button>
        </div>
      </div>
    </Sheet>
  );
}
