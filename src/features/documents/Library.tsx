import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { FolderTile } from '../../components/documents';
import { EmptyState, Loading } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { listDocuments, listFolders, listTags } from '../../services/library';
import { Collection } from './Collection';
import { FolderEditSheet } from './organize';

export default function Library() {
  const nav = useNavigate();
  const docs = useLive(listDocuments, []);
  const folders = useLive(listFolders, []);
  const tags = useLive(listTags, []);
  const [newFolder, setNewFolder] = useState(false);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of docs.data ?? []) if (d.folderId) m.set(d.folderId, (m.get(d.folderId) ?? 0) + 1);
    return m;
  }, [docs.data]);
  const base = useMemo(() => ({}), []);

  return (
    <div className="screen">
      <h1 className="large-title">Documents</h1>
      {docs.loading ? (
        <Loading />
      ) : (
        <Collection
          docs={docs.data ?? []}
          folders={folders.data ?? []}
          tags={tags.data ?? []}
          base={base}
          header={
            <section className="stack" style={{ gap: 10, marginBottom: 18 }}>
              <div className="between">
                <h2 className="section-title">Folders</h2>
                <div className="row">
                  <Link to="/favorites" className="btn btn-ghost btn-sm">
                    <Icon name="star" size={16} /> Favourites
                  </Link>
                  <Link to="/trash" className="btn btn-ghost btn-sm">
                    <Icon name="trash" size={16} /> Trash
                  </Link>
                </div>
              </div>
              <div className="folder-row">
                {(folders.data ?? []).map((f) => (
                  <FolderTile key={f.id} folder={f} count={counts.get(f.id) ?? 0} />
                ))}
                <button className="folder-tile" onClick={() => setNewFolder(true)} style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--accent)' }}>
                  <Icon name="folderPlus" />
                  <span className="name">New folder</span>
                </button>
              </div>
            </section>
          }
          empty={
            <EmptyState
              icon="docs"
              title="Your library is empty"
              message="Scan paper or import photos and PDFs. Everything stays on this device."
              action={
                <>
                  <button className="btn btn-primary" onClick={() => nav('/scan')}>
                    <Icon name="scan" /> Scan
                  </button>
                  <button className="btn btn-secondary" onClick={() => nav('/import')}>
                    <Icon name="upload" /> Import
                  </button>
                </>
              }
            />
          }
        />
      )}
      {newFolder && <FolderEditSheet open onClose={() => setNewFolder(false)} />}
    </div>
  );
}
