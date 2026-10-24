import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { EmptyState, Loading, Thumb, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { deleteDocumentsForever, emptyTrash, listTrash, restoreFromTrash } from '../../services/library';
import { useSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { formatBytes, pluralize } from '../../domain/naming';

export default function Trash() {
  const s = useSettings();
  const fb = useFeedback();
  const docs = useLive(listTrash, []);
  const [busy, setBusy] = useState<string | null>(null);
  const list = docs.data ?? [];
  const daysLeft = (deletedAt: number) => Math.max(0, Math.ceil((deletedAt + s.trashRetentionDays * 86400_000 - Date.now()) / 86400_000));

  return (
    <div className="screen no-nav">
      <TopBar
        back
        title="Trash"
        actions={
          list.length > 0 && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--danger)' }}
              onClick={async () => {
                if (await fb.confirm({ title: 'Empty Trash?', message: `${pluralize(list.length, 'document')} will be permanently deleted from this device. This can’t be undone.`, confirmLabel: 'Delete all', destructive: true })) {
                  await emptyTrash();
                  fb.toast('Trash emptied');
                }
              }}
            >
              Empty
            </button>
          )
        }
      />
      <p className="small muted" style={{ margin: '0 4px 16px' }}>
        Deleted documents stay here for {s.trashRetentionDays} days, then are removed permanently. Copies you already exported or shared aren’t affected.
      </p>
      {docs.loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState icon="trash" title="Trash is empty" message="Documents you delete appear here first, so you can change your mind." />
      ) : (
        <div className="list glass">
          {list.map((d) => (
            <div key={d.id} className="list-row">
              <Thumb path={d.thumbPath} alt="" className="doc-row-thumb" />
              <span className="grow">
                <span className="label">{d.title}</span>
                <div className="detail mono tiny">
                  {pluralize(d.pageCount, 'page')} · {formatBytes(d.sizeBytes)} · {daysLeft(d.deletedAt ?? 0)}d left
                </div>
              </span>
              <button
                className="icon-btn"
                aria-label={`Restore ${d.title}`}
                disabled={busy === d.id}
                onClick={async () => {
                  setBusy(d.id);
                  await restoreFromTrash([d.id]);
                  setBusy(null);
                  fb.toast('Restored', 'success');
                }}
              >
                <Icon name="undo" />
              </button>
              <button
                className="icon-btn"
                style={{ color: 'var(--danger)' }}
                aria-label={`Delete ${d.title} permanently`}
                onClick={async () => {
                  if (await fb.confirm({ title: 'Delete permanently?', message: `“${d.title}” will be removed from this device.`, confirmLabel: 'Delete', destructive: true })) await deleteDocumentsForever([d.id]);
                }}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
