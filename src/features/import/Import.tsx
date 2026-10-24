import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera } from '@capacitor/camera';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../../components/Icon';
import { ListRow, Progress, Segmented, Sheet, Spinner, TopBar } from '../../components/ui';
import { useFeedback } from '../../app/feedback';
import { addImagePage, createDraft, discardDraft, finalizeDraft } from '../../services/library';
import { PdfImportError, openPdf, renderPdfPage } from '../../services/pdfImport';
import { getDB } from '../../infrastructure/db';
import { isNative, uuid } from '../../infrastructure/platform';
import { useSettings } from '../../infrastructure/settings';
import { sha256Hex } from '../../domain/backupFormat';
import { formatBytes, pluralize, suggestTitle } from '../../domain/naming';

type Status = 'ready' | 'needs-password' | 'processing' | 'done' | 'failed' | 'duplicate';
interface Item {
  id: string;
  name: string;
  kind: 'image' | 'pdf';
  blob: Blob;
  hash: string;
  status: Status;
  error?: string;
  duplicateOf?: string;
  pdf?: PDFDocumentProxy;
  pageCount: number;
  selected: number[]; // 1-based PDF pages
  done: number;
}

const MAX_FILE = 200 * 1024 * 1024;
const HASH_KEY = 'importHashes';

async function knownHashes(): Promise<Record<string, string>> {
  return ((await (await getDB()).get('meta', HASH_KEY)) as Record<string, string>) ?? {};
}
async function rememberHash(hash: string, title: string) {
  const db = await getDB();
  const all = await knownHashes();
  all[hash] = title;
  await db.put('meta', all, HASH_KEY);
}

export default function Import() {
  const nav = useNavigate();
  const fb = useFeedback();
  const settings = useSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [mode, setMode] = useState<'one' | 'separate'>('one');
  const [running, setRunning] = useState(false);
  const [pick, setPick] = useState<Item | null>(null);
  const cancel = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const patch = (id: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addBlobs = async (files: { blob: Blob; name: string }[]) => {
    const hashes = await knownHashes();
    for (const f of files) {
      const isPdf = f.blob.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      const isImg = f.blob.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name);
      if (!isPdf && !isImg) {
        fb.toast(`${f.name} isn’t an image or PDF`, 'error');
        continue;
      }
      if (f.blob.size > MAX_FILE) {
        fb.toast(`${f.name} is too large (${formatBytes(f.blob.size)}). The limit is 200 MB.`, 'error');
        continue;
      }
      const buf = new Uint8Array(await f.blob.arrayBuffer());
      const hash = await sha256Hex(buf);
      const item: Item = { id: uuid(), name: f.name, kind: isPdf ? 'pdf' : 'image', blob: f.blob, hash, status: 'ready', pageCount: 1, selected: [1], done: 0 };
      if (hashes[hash]) {
        item.status = 'duplicate';
        item.duplicateOf = hashes[hash];
      }
      if (isPdf) {
        try {
          const pdf = await openPdf(buf.slice().buffer);
          item.pdf = pdf;
          item.pageCount = pdf.numPages;
          item.selected = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
        } catch (e) {
          if (e instanceof PdfImportError && e.code === 'password') item.status = 'needs-password';
          else {
            item.status = 'failed';
            item.error = (e as Error).message;
          }
        }
      }
      setItems((xs) => [...xs, item]);
    }
  };

  const unlock = async (it: Item) => {
    const pw = await fb.prompt({ title: 'Password-protected PDF', message: `Enter the password for “${it.name}”. It’s used only to open the file and isn’t stored.`, type: 'password', confirmLabel: 'Unlock' });
    if (!pw) return;
    try {
      const pdf = await openPdf(await it.blob.arrayBuffer(), pw);
      patch(it.id, { pdf, pageCount: pdf.numPages, selected: Array.from({ length: pdf.numPages }, (_, i) => i + 1), status: it.duplicateOf ? 'duplicate' : 'ready', error: undefined });
    } catch (e) {
      fb.error(e);
    }
  };

  const pickPhotos = async () => {
    if (!isNative) return input.current?.click();
    try {
      const res = await Camera.pickImages({ quality: 92, correctOrientation: true });
      const files = await Promise.all(res.photos.map(async (p, i) => ({ blob: await (await fetch(p.webPath)).blob(), name: `Photo ${i + 1}.${p.format || 'jpg'}` })));
      await addBlobs(files);
    } catch (e) {
      if (!String((e as Error)?.message).toLowerCase().includes('cancel')) fb.error(e, 'Photos could not be opened.');
    }
  };

  const importable = items.filter((i) => i.status === 'ready' || i.status === 'duplicate' || i.status === 'failed');
  const totalPages = importable.reduce((s, i) => s + (i.kind === 'pdf' ? i.selected.length : 1), 0);

  const run = async () => {
    setRunning(true);
    cancel.current = false;
    const created: string[] = [];
    let shared: string | null = null;
    try {
      for (const it of importable) {
        if (cancel.current) break;
        if (it.kind === 'pdf' && !it.pdf) continue;
        patch(it.id, { status: 'processing', done: 0, error: undefined });
        let docId: string | null = shared;
        try {
          if (!docId) {
            docId = (await createDraft(it.kind === 'pdf' ? 'pdf' : 'image')).id;
            if (mode === 'one') shared = docId;
          }
          if (it.kind === 'image') {
            await addImagePage(docId, it.blob, { filter: settings.defaultFilter, detectEdges: true, accepted: true });
            patch(it.id, { done: 1 });
          } else {
            let n = 0;
            for (const p of it.selected) {
              if (cancel.current) break;
              const blob = await renderPdfPage(it.pdf!, p, 2400);
              await addImagePage(docId, blob, { filter: 'original', detectEdges: false, accepted: true });
              patch(it.id, { done: ++n });
            }
          }
          if (mode === 'separate') {
            const d = await finalizeDraft(docId, { title: it.name.replace(/\.[^.]+$/, ''), folderId: null, tagIds: [], favorite: false });
            created.push(d.id);
          }
          await rememberHash(it.hash, it.name);
          patch(it.id, { status: 'done' });
        } catch (e) {
          patch(it.id, { status: 'failed', error: (e as Error)?.message ?? 'Import failed' });
          if (mode === 'separate' && docId) await discardDraft(docId).catch(() => undefined);
        }
      }
      if (shared) {
        const single = importable.length === 1 ? importable[0].name.replace(/\.[^.]+$/, '') : suggestTitle(new Date(), 'Import');
        const d = await finalizeDraft(shared, { title: single, folderId: null, tagIds: [], favorite: false }).catch(async (e) => {
          await discardDraft(shared!);
          throw e;
        });
        if (d.pageCount === 0) await discardDraft(d.id);
        else created.push(d.id);
      }
    } catch (e) {
      fb.error(e);
    } finally {
      setRunning(false);
    }
    if (created.length === 1) {
      fb.toast('Imported', 'success');
      nav(`/doc/${created[0]}`, { replace: true });
    } else if (created.length > 1) {
      fb.toast(`Imported ${pluralize(created.length, 'document')}`, 'success');
      nav('/documents', { replace: true });
    }
  };

  return (
    <div className="screen no-nav">
      <TopBar back title="Import" />
      <div className="stack-lg">
        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => void pickPhotos()} disabled={running}>
            <Icon name="image" /> Photos
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => input.current?.click()} disabled={running}>
            <Icon name="file" /> Files & PDFs
          </button>
        </div>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="image/*,application/pdf,.pdf"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].map((f) => ({ blob: f as Blob, name: f.name }));
            e.target.value = '';
            void addBlobs(files);
          }}
        />

        {items.length === 0 ? (
          <div className="glass card stack" style={{ gap: 8, textAlign: 'center', padding: 28 }}>
            <Icon name="upload" size={32} style={{ margin: '0 auto', color: 'var(--accent)' }} />
            <strong>Bring in existing photos and PDFs</strong>
            <p className="small muted">Photos are straightened and cleaned up like scans. PDF pages are kept as they are. Files are copied into the app and never uploaded.</p>
          </div>
        ) : (
          <>
            <Segmented label="Import as" value={mode} onChange={setMode} options={[{ value: 'one', label: 'One document' }, { value: 'separate', label: 'One per file' }]} />
            <div className="list glass">
              {items.map((it) => (
                <div key={it.id} className="list-row">
                  <span className={`row-icon ${it.status === 'failed' ? 'danger' : it.status === 'done' ? 'success' : it.status === 'duplicate' || it.status === 'needs-password' ? 'warning' : ''}`}>
                    {it.status === 'processing' ? <Spinner /> : <Icon name={it.status === 'done' ? 'check' : it.status === 'failed' ? 'alert' : it.status === 'needs-password' ? 'lock' : it.kind === 'pdf' ? 'pdf' : 'image'} />}
                  </span>
                  <span className="grow">
                    <span className="label" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                    <span className="detail small">
                      {it.status === 'processing'
                        ? `Importing ${it.done}/${it.kind === 'pdf' ? it.selected.length : 1}…`
                        : it.status === 'failed'
                          ? it.error
                          : it.status === 'needs-password'
                            ? 'Password required'
                            : it.status === 'duplicate'
                              ? `Already imported as “${it.duplicateOf}” — will import again`
                              : it.status === 'done'
                                ? 'Imported'
                                : it.kind === 'pdf'
                                  ? `${it.selected.length} of ${pluralize(it.pageCount, 'page')} · ${formatBytes(it.blob.size)}`
                                  : formatBytes(it.blob.size)}
                    </span>
                  </span>
                  {it.status === 'needs-password' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => void unlock(it)}>
                      Unlock
                    </button>
                  )}
                  {it.kind === 'pdf' && it.pdf && !running && it.status !== 'done' && it.pageCount > 1 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setPick(it)}>
                      Pages
                    </button>
                  )}
                  {!running && it.status !== 'done' && (
                    <button className="icon-btn" aria-label={`Remove ${it.name}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                      <Icon name="close" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {running ? (
              <div className="stack">
                <Progress value={null} label="Importing" />
                <button className="btn btn-secondary" onClick={() => (cancel.current = true)}>
                  Stop after current page
                </button>
              </div>
            ) : (
              <button className="btn btn-primary btn-block" disabled={!totalPages} onClick={() => void run()}>
                <Icon name="upload" /> Import {pluralize(totalPages, 'page')}
              </button>
            )}
          </>
        )}
      </div>
      {pick && <PdfPagePicker item={pick} onClose={() => setPick(null)} onSave={(sel) => (patch(pick.id, { selected: sel }), setPick(null))} />}
    </div>
  );
}

function PdfPagePicker({ item, onClose, onSave }: { item: Item; onClose: () => void; onSave: (sel: number[]) => void }) {
  const [sel, setSel] = useState<number[]>(item.selected);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const loading = useRef(new Set<number>());
  const ensure = (n: number) => {
    if (thumbs[n] || loading.current.has(n) || !item.pdf) return;
    loading.current.add(n);
    void renderPdfPage(item.pdf, n, 260).then((b) => setThumbs((t) => ({ ...t, [n]: URL.createObjectURL(b) })));
  };
  const all = Array.from({ length: item.pageCount }, (_, i) => i + 1);
  return (
    <Sheet open onClose={onClose} title="Choose pages">
      <div className="between" style={{ marginBottom: 12 }}>
        <span className="eyebrow">
          {sel.length} of {item.pageCount} selected
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setSel(sel.length === all.length ? [] : all)}>
          {sel.length === all.length ? 'Select none' : 'Select all'}
        </button>
      </div>
      <div className="page-grid" style={{ maxHeight: '52dvh', overflow: 'auto', padding: 4 }}>
        {all.slice(0, 300).map((n) => {
          ensure(n);
          const on = sel.includes(n);
          return (
            <button key={n} className="page-tile" aria-selected={on} aria-label={`Page ${n}`} onClick={() => setSel((s) => (on ? s.filter((x) => x !== n) : [...s, n].sort((a, b) => a - b)))}>
              <div className="thumb">{thumbs[n] ? <img src={thumbs[n]} alt="" /> : <div className="placeholder"><Spinner /></div>}</div>
              <span className="check">
                <Icon name="check" size={16} />
              </span>
              <span className="num">{n}</span>
            </button>
          );
        })}
      </div>
      {item.pageCount > 300 && <ListRow icon="info" label="Showing the first 300 pages" detail="Pages beyond 300 keep their current selection." />}
      <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} disabled={!sel.length} onClick={() => onSave(sel)}>
        Use {pluralize(sel.length, 'page')}
      </button>
    </Sheet>
  );
}
