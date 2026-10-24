import { useMemo } from 'react';
import { EmptyState, Loading, TopBar } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { listDocuments, listFolders, listTags } from '../../services/library';
import { Collection } from './Collection';

export default function Favorites() {
  const docs = useLive(listDocuments, []);
  const folders = useLive(listFolders, []);
  const tags = useLive(listTags, []);
  const base = useMemo(() => ({ favorite: true }), []);
  const favs = (docs.data ?? []).filter((d) => d.favorite);
  return (
    <div className="screen no-nav">
      <TopBar back title="Favourites" />
      {docs.loading ? (
        <Loading />
      ) : (
        <Collection
          docs={favs}
          folders={folders.data ?? []}
          tags={tags.data ?? []}
          base={base}
          empty={<EmptyState icon="star" title="No favourites yet" message="Tap the star on any document to keep it close." />}
        />
      )}
    </div>
  );
}
