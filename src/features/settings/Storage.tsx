import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ListRow, Loading, Section, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { cleanOrphanFiles, discardDraft, emptyTrash, listDrafts, storageStats } from '../../services/library';
import { installedLanguages, OCR_LANGUAGES } from '../../services/ocr';
import { useFeedback } from '../../app/feedback';
import { formatBytes, formatDate, pluralize } from '../../domain/naming';

export default function Storage() {
  const fb = useFeedback();
  const stats = useLive(storageStats, []);
  const drafts = useLive(listDrafts, []);
  const models = useLive(installedLanguages, []);
  if (stats.loading || !stats.data) return <Loading />;
  const st = stats.data;
  const modelMb = (models.data ?? []).reduce((s, c) => s + (OCR_LANGUAGES.find((l) => l.code === c)?.size ?? 0), 0);
  const quotaPct = st.quota ? Math.min(100, (st.bytes / st.quota) * 100) : null;

  return (
    <div className="screen no-nav">
      <TopBar back title="Storage" />
      <div className="stack-lg">
        <section className="glass card stack" style={{ gap: 10 }}>
          <span className="eyebrow">Used by your documents</span>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '2.4rem', fontWeight: 650 }}>{formatBytes(st.bytes)}</div>
          <dl className="kv">
            <dt>Documents</dt>
            <dd className="mono">{st.documents}</dd>
            <dt>Image files</dt>
            <dd className="mono">{st.files}</dd>
            <dt>In Trash</dt>
            <dd className="mono">
              {st.trash} · {formatBytes(st.trashBytes)}
            </dd>
            <dt>OCR language models</dt>
            <dd className="mono">≈ {modelMb.toFixed(1)} MB</dd>
            {quotaPct !== null && (
              <>
                <dt>Share of app storage</dt>
                <dd className="mono">{quotaPct < 0.1 ? '<0.1' : quotaPct.toFixed(1)}%</dd>
              </>
            )}
          </dl>
          <p className="tiny muted">Each page keeps its original capture (so edits are reversible), a processed copy and a small preview.</p>
        </section>

        {st.largest.length > 0 && (
          <Section title="Largest documents">
            {st.largest.map((d) => (
              <Link key={d.id} to={`/doc/${d.id}`} className="list-row">
                <Thumb path={d.thumbPath} alt="" className="doc-row-thumb" />
                <span className="grow">
                  <span className="label">{d.title}</span>
                  <div className="detail mono tiny">{pluralize(d.pageCount, 'page')}</div>
                </span>
                <span className="mono small">{formatBytes(d.sizeBytes)}</span>
              </Link>
            ))}
          </Section>
        )}

        {(drafts.data?.length ?? 0) > 0 && (
          <Section title="Unsaved scans">
            {drafts.data!.map((d) => (
              <div key={d.id} className="list-row">
                <span className="row-icon warning">
                  <Icon name="refresh" />
                </span>
                <span className="grow">
                  <span className="label">{d.title}</span>
                  <div className="detail mono tiny">
                    {formatDate(d.createdAt)} · {formatBytes(d.sizeBytes)}
                  </div>
                </span>
                <Link className="btn btn-secondary btn-sm" to={`/save/${d.id}`}>
                  Resume
                </Link>
                <button className="icon-btn" aria-label="Discard unsaved scan" onClick={async () => (await fb.confirm({ title: 'Discard this scan?', confirmLabel: 'Discard', destructive: true })) && discardDraft(d.id)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </Section>
        )}

        <Section title="Clean up">
          <ListRow
            icon="trash"
            label="Empty Trash"
            detail={st.trash ? `Frees about ${formatBytes(st.trashBytes)}` : 'Trash is empty'}
            onClick={
              st.trash
                ? async () => {
                    if (await fb.confirm({ title: 'Empty Trash?', message: 'Deleted documents will be removed permanently.', confirmLabel: 'Empty Trash', destructive: true })) {
                      await emptyTrash();
                      fb.toast('Trash emptied', 'success');
                    }
                  }
                : undefined
            }
          />
          <ListRow
            icon="refresh"
            label="Remove leftover files"
            detail="Clears image files left behind by interrupted edits. Your documents aren’t touched."
            onClick={async () => {
              if (!(await fb.confirm({ title: 'Remove leftover files?', message: 'Only files that no document uses are removed.', confirmLabel: 'Clean up' }))) return;
              const n = await cleanOrphanFiles();
              fb.toast(n ? `Removed ${pluralize(n, 'leftover file')}` : 'Nothing to clean up', 'success');
            }}
          />
          <ListRow icon="globe" label="OCR languages" detail="Remove downloaded models you don’t need" to="/settings/ocr" />
        </Section>
      </div>
    </div>
  );
}
