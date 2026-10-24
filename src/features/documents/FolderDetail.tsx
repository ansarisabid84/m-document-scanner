import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmptyState, ErrorState, ListRow, Loading, Sheet, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { deleteFolder, getFolder, listDocuments, listFolders, listTags } from '../../services/library';
import { useFeedback } from '../../app/feedback';
import { Collection } from './Collection';
import { FolderEditSheet } from './organize';

export default function FolderDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const fb = useFeedback();
  const folder = useLive(() => getFolder(id), [id]);
  const docs = useLive(listDocuments, []);
  const folders = useLive(listFolders, []);
  const tags = useLive(listTags, []);
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const base = useMemo(() => ({ folderId: id }), [id]);
  if (folder.loading) return <Loading />;
  if (!folder.data) return <ErrorState title="Folder not found" action={<button className="btn btn-primary" onClick={() => nav('/documents')}>Open library</button>} />;
  const f = folder.data;
  return (
    <div className="screen no-nav">
      <TopBar
        back
        title={f.name}
        actions={
          <button className="icon-btn" aria-label="Folder options" onClick={() => setMenu(true)}>
            <Icon name="more" />
          </button>
        }
      />
      <div className="row" style={{ gap: 12, margin: '0 4px 16px' }}>
        <span className="row-icon" style={{ width: 44, height: 44, borderRadius: 14, background: `${f.color}22`, color: f.color }}>
          <Icon name={f.icon as never} />
        </span>
        <h1 style={{ fontSize: '1.7rem' }}>{f.name}</h1>
      </div>
      <Collection
        docs={(docs.data ?? []).filter((d) => d.folderId === id)}
        folders={folders.data ?? []}
        tags={tags.data ?? []}
        base={base}
        empty={<EmptyState icon="folder" title="This folder is empty" message="Move documents here from the library, or pick this folder when saving a scan." action={<button className="btn btn-primary" onClick={() => nav('/scan')}><Icon name="scan" /> Scan</button>} />}
      />
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="list">
          <ListRow icon="palette" label="Rename, colour & icon" onClick={() => (setMenu(false), setEdit(true))} />
          <ListRow
            icon="trash"
            label="Delete folder"
            danger
            onClick={async () => {
              setMenu(false);
              if (await fb.confirm({ title: `Delete “${f.name}”?`, message: 'Documents inside are kept and moved to “No folder”.', confirmLabel: 'Delete folder', destructive: true })) {
                await deleteFolder(id);
                nav('/documents', { replace: true });
              }
            }}
          />
        </div>
      </Sheet>
      {edit && <FolderEditSheet open folder={f} onClose={() => setEdit(false)} />}
    </div>
  );
}
