import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorState, ListRow, Loading, Switch, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { discardDraft, finalizeDraft, getDocument, getPages, listFolders, listTags } from '../../services/library';
import { runOcr } from '../../services/ocr';
import { getSettings, useSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { success } from '../../infrastructure/haptics';
import { formatBytes, pluralize } from '../../domain/naming';
import { FolderPicker, TagPicker } from './organize';

export default function SaveDocument() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const settings = useSettings();
  const doc = useLive(() => getDocument(id), [id]);
  const pages = useLive(async () => (await getPages(id)).filter((p) => p.accepted), [id]);
  const folders = useLive(listFolders, []);
  const tags = useLive(listTags, []);
  const [title, setTitle] = useState('');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [ocr, setOcr] = useState(settings.autoOcr);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (doc.data && !title) setTitle(doc.data.title);
  }, [doc.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (doc.loading) return <Loading />;
  if (!doc.data) return <ErrorState title="Scan not found" message="This scan may already have been saved or discarded." action={<button className="btn btn-primary" onClick={() => nav('/', { replace: true })}>Go home</button>} />;
  if (!doc.data.draft) return <Navigate to={`/doc/${id}`} replace />;
  const list = pages.data ?? [];

  const save = async () => {
    setSaving(true);
    try {
      const saved = await finalizeDraft(id, { title, folderId, tagIds, favorite });
      success();
      fb.toast('Saved to this device', 'success');
      nav(`/doc/${saved.id}`, { replace: true });
      if (ocr) void runOcr(saved.id, getSettings().ocrLanguages).catch((e) => fb.error(e));
    } catch (e) {
      fb.error(e, 'Could not save. Your pages are still here — try again.');
      setSaving(false);
    }
  };

  return (
    <div className="screen no-nav">
      <TopBar
        title="Save document"
        back
        onBack={() => nav(`/scan?doc=${id}`, { replace: true })}
        actions={
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--danger)' }}
            onClick={async () => {
              if (await fb.confirm({ title: 'Discard this scan?', message: `${pluralize(list.length, 'page')} will be deleted.`, confirmLabel: 'Discard', destructive: true })) {
                await discardDraft(id);
                nav('/', { replace: true });
              }
            }}
          >
            Discard
          </button>
        }
      />
      {list.length === 0 ? (
        <EmptyState icon="file" title="No pages kept" message="Capture or import at least one page." action={<button className="btn btn-primary" onClick={() => nav(`/scan?doc=${id}`, { replace: true })}>Back to scanner</button>} />
      ) : (
        <form
          className="stack-lg"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <section className="stack" style={{ gap: 10 }}>
            <div className="between">
              <span className="eyebrow">
                {pluralize(list.length, 'page')} · {formatBytes(list.reduce((s, p) => s + p.sizeBytes, 0))}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }} onClick={() => nav(`/doc/${id}/pages`)}>
                <Icon name="grid" size={16} /> Review pages
              </button>
            </div>
            <div className="recent-strip" style={{ gridAutoColumns: 92 }}>
              {list.map((p, i) => (
                <div key={p.id}>
                  <Thumb path={p.thumbPath} alt={`Page ${i + 1}`} />
                  <div className="mono tiny muted" style={{ textAlign: 'center', marginTop: 4 }}>{i + 1}</div>
                </div>
              ))}
              <button type="button" className="thumb glass" style={{ display: 'grid', placeItems: 'center', border: 0, color: 'var(--accent)' }} onClick={() => nav(`/scan?doc=${id}`, { replace: true })} aria-label="Add more pages">
                <Icon name="plus" />
              </button>
            </div>
          </section>

          <div className="field">
            <label htmlFor="title">Name</label>
            <input id="title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} onFocus={(e) => e.currentTarget.select()} maxLength={120} enterKeyHint="done" />
          </div>
          <div className="field">
            <span className="field-label">Folder</span>
            <FolderPicker folders={folders.data ?? []} value={folderId} onChange={setFolderId} />
          </div>
          <div className="field">
            <span className="field-label">Tags</span>
            <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
          </div>
          <div className="list glass">
            <ListRow icon="star" label="Favourite" trailing={<Switch label="Favourite" checked={favorite} onChange={setFavorite} />} />
            <ListRow icon="ocr" label="Recognise text" detail="On-device. Makes this document searchable." trailing={<Switch label="Recognise text" checked={ocr} onChange={setOcr} />} />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save document'}
          </button>
        </form>
      )}
    </div>
  );
}
