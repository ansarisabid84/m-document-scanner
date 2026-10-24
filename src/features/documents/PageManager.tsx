import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmptyState, ListRow, Loading, Sheet, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { useFileUrl } from '../../hooks/useFileUrl';
import { deletePage, duplicatePage, getDocument, getPages, reorderPages, rotatePage, splitPages } from '../../services/library';
import { useFeedback } from '../../app/feedback';
import { tap } from '../../infrastructure/haptics';
import type { Page } from '../../domain/models';
import { pluralize } from '../../domain/naming';

/** Multi-page review: reorder (drag or buttons), rotate, duplicate, delete, split. */
export default function PageManager() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const doc = useLive(() => getDocument(id), [id]);
  const pages = useLive(async () => (await getPages(id)).filter((p) => p.accepted), [id]);
  const [order, setOrder] = useState<Page[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [menu, setMenu] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; over: number } | null>(null);
  const tiles = useRef(new Map<string, HTMLElement>());
  const pressTimer = useRef<ReturnType<typeof setTimeout>>();
  const dragUrl = useFileUrl(order.find((p) => p.id === drag?.id)?.thumbPath);

  useEffect(() => {
    if (pages.data && !drag) setOrder(pages.data);
  }, [pages.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pages.loading) return <Loading />;

  const commitOrder = async (next: Page[]) => {
    setOrder(next);
    try {
      await reorderPages(id, next.map((p) => p.id));
    } catch (e) {
      fb.error(e);
    }
  };
  const moveBy = (p: Page, delta: number) => {
    const i = order.findIndex((x) => x.id === p.id);
    const j = Math.max(0, Math.min(order.length - 1, i + delta));
    if (i === j) return;
    const next = [...order];
    next.splice(i, 1);
    next.splice(j, 0, p);
    void commitOrder(next);
  };

  const targetIndex = (x: number, y: number) => {
    let best = order.length;
    let bestD = Infinity;
    order.forEach((p, i) => {
      const el = tiles.current.get(p.id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d < bestD) {
        bestD = d;
        best = x < cx ? i : i + 1;
      }
    });
    return best;
  };

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fb.error(e);
    } finally {
      setBusy(false);
    }
  };

  const removePages = async (ids: string[]) => {
    if (ids.length >= order.length && !doc.data?.draft) {
      fb.toast('A document needs at least one page. Move the document to Trash instead.', 'error');
      return;
    }
    if (!(await fb.confirm({ title: `Delete ${pluralize(ids.length, 'page')}?`, message: 'This can’t be undone.', confirmLabel: 'Delete', destructive: true }))) return;
    await withBusy(async () => {
      for (const pid of ids) await deletePage(pid);
      setSel([]);
      setSelecting(false);
    });
  };

  return (
    <div className="screen no-nav">
      <TopBar
        back
        title={selecting ? `${sel.length} selected` : 'Arrange pages'}
        actions={
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelecting(!selecting);
              setSel([]);
            }}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        }
      />
      {order.length === 0 ? (
        <EmptyState icon="file" title="No pages" message="Add pages with the camera or import images." action={<button className="btn btn-primary" onClick={() => nav(doc.data?.draft ? `/scan?doc=${id}` : `/scan?add=${id}`)}>Add pages</button>} />
      ) : (
        <>
          <p className="small muted" style={{ margin: '0 4px 14px' }}>
            {selecting ? 'Tap pages to select them.' : 'Press and hold a page to drag it. Tap for more options.'}
          </p>
          <div className="page-grid" style={{ paddingBottom: selecting ? 90 : 0 }}>
            {order.map((p, i) => (
              <button
                key={p.id}
                ref={(el) => {
                  if (el) tiles.current.set(p.id, el);
                  else tiles.current.delete(p.id);
                }}
                className={`page-tile ${drag?.id === p.id ? 'dragging' : ''} ${drag && drag.over === i && drag.id !== p.id ? 'drop-before' : ''}`}
                aria-selected={selecting ? sel.includes(p.id) : undefined}
                aria-label={`Page ${i + 1}`}
                style={{ touchAction: drag ? 'none' : 'manipulation' }}
                onPointerDown={(e) => {
                  if (selecting) return;
                  const { clientX, clientY, pointerId } = e;
                  const el = e.currentTarget;
                  pressTimer.current = setTimeout(() => {
                    el.setPointerCapture(pointerId);
                    tap('medium');
                    setDrag({ id: p.id, x: clientX, y: clientY, over: i });
                  }, 380);
                }}
                onPointerMove={(e) => {
                  if (!drag) {
                    if (Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(pressTimer.current);
                    return;
                  }
                  setDrag({ ...drag, x: e.clientX, y: e.clientY, over: targetIndex(e.clientX, e.clientY) });
                }}
                onPointerUp={() => {
                  clearTimeout(pressTimer.current);
                  if (!drag) return;
                  const from = order.findIndex((x) => x.id === drag.id);
                  let to = drag.over;
                  const next = [...order];
                  const [m] = next.splice(from, 1);
                  if (to > from) to--;
                  next.splice(to, 0, m);
                  setDrag(null);
                  if (to !== from) void commitOrder(next);
                }}
                onPointerCancel={() => {
                  clearTimeout(pressTimer.current);
                  setDrag(null);
                }}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  if (drag) return;
                  if (selecting) setSel((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]));
                  else setMenu(p);
                }}
              >
                <Thumb path={p.thumbPath} alt="" />
                {selecting && (
                  <span className="check">
                    <Icon name="check" size={16} />
                  </span>
                )}
                <span className="num">{i + 1}</span>
              </button>
            ))}
            {!selecting && (
              <button className="page-tile" onClick={() => nav(doc.data?.draft ? `/scan?doc=${id}` : `/scan?add=${id}`)} aria-label="Add pages">
                <div className="thumb glass" style={{ display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>
                  <Icon name="plus" />
                </div>
                <span className="num">Add</span>
              </button>
            )}
          </div>
        </>
      )}

      {drag && dragUrl && (
        <div className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          <img src={dragUrl} alt="" />
        </div>
      )}

      {selecting && (
        <div className="select-bar glass-strong">
          <button disabled={!sel.length || busy} onClick={() => void withBusy(async () => { for (const pid of sel) await rotatePage(pid, -1); })}>
            <Icon name="rotateCcw" /> Left
          </button>
          <button disabled={!sel.length || busy} onClick={() => void withBusy(async () => { for (const pid of sel) await rotatePage(pid, 1); })}>
            <Icon name="rotateCw" /> Right
          </button>
          <button
            disabled={!sel.length || sel.length === order.length || busy || doc.data?.draft}
            onClick={() =>
              void withBusy(async () => {
                const n = await splitPages(id, order.filter((p) => sel.includes(p.id)).map((p) => p.id));
                fb.toast(`Moved ${pluralize(sel.length, 'page')} to a new document`, 'success');
                nav(`/doc/${n.id}`);
              })
            }
          >
            <Icon name="split" /> Extract
          </button>
          <button className="danger" disabled={!sel.length || busy} onClick={() => void removePages(sel)}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? `Page ${order.findIndex((p) => p.id === menu.id) + 1}` : ''}>
        {menu && (
          <div className="list">
            <ListRow icon="crop" label="Crop, filters & adjust" onClick={() => (setMenu(null), nav(`/doc/${id}/edit/${menu.id}`))} />
            <ListRow icon="pen" label="Sign, annotate or redact" onClick={() => (setMenu(null), nav(`/doc/${id}/markup/${menu.id}`))} />
            <ListRow icon="rotateCw" label="Rotate right" onClick={() => void withBusy(async () => { await rotatePage(menu.id, 1); setMenu(null); })} />
            <ListRow icon="rotateCcw" label="Rotate left" onClick={() => void withBusy(async () => { await rotatePage(menu.id, -1); setMenu(null); })} />
            <ListRow icon="back" label="Move earlier" onClick={() => (moveBy(menu, -1), setMenu(null))} />
            <ListRow icon="chevronRight" label="Move later" onClick={() => (moveBy(menu, 1), setMenu(null))} />
            <ListRow icon="copy" label="Duplicate" onClick={() => void withBusy(async () => { await duplicatePage(menu.id); setMenu(null); })} />
            <ListRow icon="trash" label="Delete page" danger onClick={() => { const m = menu; setMenu(null); void removePages([m.id]); }} />
          </div>
        )}
      </Sheet>
    </div>
  );
}
