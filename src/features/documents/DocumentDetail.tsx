import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ErrorState, ListRow, Loading, Progress, Sheet, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import {
  duplicateDocument,
  getDocument,
  getFolder,
  getPages,
  listDocuments,
  listFolders,
  listTags,
  mergeDocuments,
  moveToTrash,
  restoreFromTrash,
  updateDocument,
} from '../../services/library';
import { cancelOcr, runOcr, useOcrJob } from '../../services/ocr';
import { getSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { formatBytes, formatDate, pluralize } from '../../domain/naming';
import { ExportSheet } from '../export/ExportSheet';
import { FolderPicker, TagPicker } from './organize';

const OCR_LABEL: Record<string, string> = {
  none: 'Not recognised',
  done: 'Text recognised',
  running: 'Recognising…',
  failed: 'Some pages failed',
  stale: 'Partly recognised',
  queued: 'Queued',
};

export default function DocumentDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const doc = useLive(() => getDocument(id), [id]);
  const pages = useLive(async () => (await getPages(id)).filter((p) => p.accepted), [id]);
  const folder = useLive(async () => (doc.data?.folderId ? getFolder(doc.data.folderId) : undefined), [doc.data?.folderId]);
  const folders = useLive(listFolders, []);
  const tags = useLive(listTags, []);
  const job = useOcrJob();
  const [exportOpen, setExportOpen] = useState(false);
  const [organize, setOrganize] = useState(false);
  const [more, setMore] = useState(false);
  const [merge, setMerge] = useState(false);

  if (doc.loading) return <Loading />;
  if (!doc.data)
    return (
      <div className="screen no-nav">
        <TopBar back />
        <ErrorState title="Document not found" message="It may have been deleted." action={<Link className="btn btn-primary" to="/documents">Open library</Link>} />
      </div>
    );
  const d = doc.data;
  const list = pages.data ?? [];
  const running = job?.docId === id && job.status === 'running';
  const docTags = (tags.data ?? []).filter((t) => d.tagIds.includes(t.id));

  const ocr = async () => {
    try {
      await runOcr(id, getSettings().ocrLanguages, d.ocrStatus === 'done' ? list.map((p) => p.id) : undefined);
      const after = await getPages(id);
      if (after.some((p) => p.ocrStatus === 'failed')) fb.toast('Some pages could not be read. Try a clearer scan or another language.', 'error');
      else fb.toast('Text recognised — now searchable', 'success');
    } catch (e) {
      fb.error(e);
    }
  };

  const rename = async () => {
    const t = await fb.prompt({ title: 'Rename document', initial: d.title, confirmLabel: 'Rename' });
    if (t) await updateDocument(id, { title: t });
  };

  const trash = async () => {
    await moveToTrash([id]);
    nav(-1);
    fb.toast('Moved to Trash', 'info', { label: 'Undo', run: () => void restoreFromTrash([id]) });
  };

  return (
    <div className="screen no-nav">
      <TopBar
        back
        title={d.title}
        actions={
          <>
            <button className="icon-btn" aria-label={d.favorite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={d.favorite} onClick={() => void updateDocument(id, { favorite: !d.favorite })}>
              <Icon name="star" filled={d.favorite} style={d.favorite ? { color: '#f5b301' } : undefined} />
            </button>
            <button className="icon-btn" aria-label="More actions" onClick={() => setMore(true)}>
              <Icon name="more" />
            </button>
          </>
        }
      />
      <div className="stack-lg">
        <section className="stack" style={{ gap: 8 }}>
          <button className="btn-ghost" onClick={() => void rename()} style={{ border: 0, background: 'none', textAlign: 'left', padding: '0 4px' }} aria-label={`Rename ${d.title}`}>
            <h1 style={{ fontSize: '1.7rem' }}>{d.title}</h1>
          </button>
          <div className="row wrap" style={{ gap: 6, padding: '0 4px' }}>
            <span className="badge mono">{pluralize(d.pageCount, 'page')}</span>
            <span className="badge mono">{formatBytes(d.sizeBytes)}</span>
            <span className="badge mono">{formatDate(d.createdAt)}</span>
            <span className={`badge ${d.ocrStatus === 'done' ? 'success' : d.ocrStatus === 'failed' ? 'danger' : ''}`}>
              <Icon name="text" /> {OCR_LABEL[d.ocrStatus] ?? d.ocrStatus}
            </span>
            {folder.data && (
              <Link to={`/folder/${folder.data.id}`} className="badge accent" style={{ textDecoration: 'none' }}>
                <Icon name="folder" /> {folder.data.name}
              </Link>
            )}
            {docTags.map((t) => (
              <span key={t.id} className="badge">
                <Icon name="tag" /> {t.name}
              </span>
            ))}
          </div>
        </section>

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setExportOpen(true)} disabled={!list.length}>
            <Icon name="share" /> Export
          </button>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => nav(`/scan?add=${id}`)}>
            <Icon name="plus" /> Add pages
          </button>
        </div>

        {running && job && (
          <div className="glass card stack" style={{ gap: 10 }}>
            <div className="between">
              <span>
                Recognising text <span className="mono muted">{job.done}/{job.total}</span>
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => void cancelOcr()}>
                Cancel
              </button>
            </div>
            <Progress value={job.total ? job.done / job.total : null} label="Text recognition progress" />
          </div>
        )}

        <section className="stack" style={{ gap: 10 }}>
          <div className="between">
            <h2 className="section-title">Pages</h2>
            <Link to={`/doc/${id}/pages`} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }}>
              <Icon name="grid" size={16} /> Arrange
            </Link>
          </div>
          <div className="page-grid">
            {list.map((p, i) => (
              <Link key={p.id} to={`/doc/${id}/view/${i}`} className="page-tile" aria-label={`Open page ${i + 1}`}>
                <Thumb path={p.thumbPath} alt="" />
                <span className="num">{i + 1}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="list glass">
          <ListRow icon="ocr" label={d.ocrStatus === 'done' ? 'Recognise text again' : 'Recognise text'} detail="Runs on this device. Printed text works best; handwriting isn’t supported." onClick={running ? undefined : () => void ocr()} chevron={!running} />
          <ListRow icon="folderMove" label="Folder & tags" detail={[folder.data?.name ?? 'No folder', docTags.length ? pluralize(docTags.length, 'tag') : null].filter(Boolean).join(' · ')} onClick={() => setOrganize(true)} chevron />
          <ListRow icon="pen" label="Sign, annotate or redact" detail="Opens the first page; pick others from Arrange" onClick={() => list[0] && nav(`/doc/${id}/markup/${list[0].id}`)} chevron />
        </section>
      </div>

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} doc={d} pages={list} />

      <Sheet open={organize} onClose={() => setOrganize(false)} title="Folder & tags">
        <div className="stack" style={{ gap: 18 }}>
          <div className="field">
            <span className="field-label">Folder</span>
            <FolderPicker folders={folders.data ?? []} value={d.folderId} onChange={(f) => void updateDocument(id, { folderId: f })} />
          </div>
          <div className="field">
            <span className="field-label">Tags</span>
            <TagPicker tags={tags.data ?? []} value={d.tagIds} onChange={(t) => void updateDocument(id, { tagIds: t })} />
          </div>
          <button className="btn btn-primary btn-block" onClick={() => setOrganize(false)}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={more} onClose={() => setMore(false)}>
        <div className="list">
          <ListRow icon="text" label="Rename" onClick={() => (setMore(false), void rename())} />
          <ListRow
            icon="copy"
            label="Duplicate"
            onClick={async () => {
              setMore(false);
              const c = await duplicateDocument(id);
              fb.toast('Duplicated', 'success');
              nav(`/doc/${c.id}`);
            }}
          />
          <ListRow icon="merge" label="Merge with other documents…" onClick={() => (setMore(false), setMerge(true))} />
          <ListRow icon="trash" label="Move to Trash" danger onClick={() => (setMore(false), void trash())} />
        </div>
      </Sheet>

      {merge && <MergeSheet baseId={id} baseTitle={d.title} onClose={() => setMerge(false)} />}
    </div>
  );
}

function MergeSheet({ baseId, baseTitle, onClose }: { baseId: string; baseTitle: string; onClose: () => void }) {
  const nav = useNavigate();
  const fb = useFeedback();
  const docs = useLive(async () => (await listDocuments()).filter((d) => d.id !== baseId).sort((a, b) => b.updatedAt - a.updatedAt), [baseId]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Merge documents">
      <p className="small muted" style={{ margin: '0 4px 12px' }}>
        Pages are combined in the order you pick them, after “{baseTitle}”. The originals are kept.
      </p>
      <div className="list glass" style={{ maxHeight: '45dvh', overflow: 'auto' }}>
        {(docs.data ?? []).map((d) => {
          const n = picked.indexOf(d.id);
          return (
            <button key={d.id} className="list-row" aria-pressed={n >= 0} onClick={() => setPicked((p) => (n >= 0 ? p.filter((x) => x !== d.id) : [...p, d.id]))}>
              <span className="row-icon" style={n >= 0 ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--surface-sunken)' }}>
                {n >= 0 ? <span className="mono">{n + 2}</span> : <Icon name="plus" />}
              </span>
              <Thumb path={d.thumbPath} alt="" className="doc-row-thumb" />
              <span className="grow">
                <span className="label">{d.title}</span>
                <div className="detail mono tiny">{pluralize(d.pageCount, 'page')}</div>
              </span>
            </button>
          );
        })}
        {docs.data?.length === 0 && <p className="muted" style={{ padding: 16 }}>No other documents to merge.</p>}
      </div>
      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={!picked.length || busy}
        onClick={async () => {
          setBusy(true);
          try {
            const m = await mergeDocuments([baseId, ...picked], `${baseTitle} (merged)`);
            fb.toast('Merged into a new document', 'success');
            onClose();
            nav(`/doc/${m.id}`);
          } catch (e) {
            fb.error(e);
            setBusy(false);
          }
        }}
      >
        <Icon name="merge" /> {busy ? 'Merging…' : `Merge ${picked.length + 1} documents`}
      </button>
    </Sheet>
  );
}
