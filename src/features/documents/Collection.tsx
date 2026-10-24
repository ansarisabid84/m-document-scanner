import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { DocCard, DocRow } from '../../components/documents';
import { EmptyState, ListRow, Segmented, Sheet } from '../../components/ui';
import type { DocumentRecord, Folder, SortKey, Tag } from '../../domain/models';
import { filterDocuments, sortDocuments, type LibraryFilter } from '../../domain/search';
import { pluralize } from '../../domain/naming';
import { updateSettings, useSettings } from '../../infrastructure/settings';
import { useFeedback } from '../../app/feedback';
import { useBackHandler } from '../../app/backStack';
import { mergeDocuments, moveDocuments, moveToTrash, restoreFromTrash, setFavorite } from '../../services/library';
import { exportDocument } from '../../services/exporter';
import { getPages } from '../../services/library';
import { shareFiles, type OutFile } from '../../infrastructure/sharing';
import { FolderPicker } from './organize';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'modified', label: 'Last modified' },
  { value: 'name', label: 'Name' },
  { value: 'size', label: 'Size' },
];

/** Shared library view: list/grid, sort, filter, multi-select with bulk actions. */
export function Collection({
  docs,
  folders,
  tags,
  base,
  empty,
  header,
}: {
  docs: DocumentRecord[];
  folders: Folder[];
  tags: Tag[];
  base: LibraryFilter;
  empty: ReactNode;
  header?: ReactNode;
}) {
  const s = useSettings();
  const nav = useNavigate();
  const fb = useFeedback();
  const [filter, setFilter] = useState<LibraryFilter>({});
  const [text, setText] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useBackHandler(() => (setSelecting(false), setSel([])), selecting);

  const shown = useMemo(() => sortDocuments(filterDocuments(docs, { ...base, ...filter, text }), s.librarySort), [docs, base, filter, text, s.librarySort]);
  const folderMap = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const activeFilters = Object.entries(filter).filter(([, v]) => v && v !== 'any' && v !== 'all').length;
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const startSelect = (id: string) => {
    setSelecting(true);
    setSel([id]);
  };
  const done = () => {
    setSelecting(false);
    setSel([]);
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fb.error(e);
    } finally {
      setBusy(false);
    }
  };

  const bulkShare = () =>
    act(async () => {
      const files: OutFile[] = [];
      for (const id of sel) {
        const d = docs.find((x) => x.id === id);
        if (!d) continue;
        const out = await exportDocument(d, await getPages(id), { format: 'pdf', quality: s.exportQuality, pageSize: s.exportPageSize, colorMode: 'as-is', ocrLayer: s.exportOcrLayer, range: '', fileName: d.title }, () => undefined, new AbortController().signal);
        files.push(...out);
      }
      await shareFiles(files, pluralize(files.length, 'document'));
    });

  if (docs.filter((d) => !d.deletedAt && !d.draft).length === 0) return <>{header}{empty}</>;

  return (
    <>
      {header}
      <div className="stack" style={{ gap: 12 }}>
        <div className="row">
          <div className="search-field" style={{ flex: 1 }}>
            <Icon name="search" />
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by name" aria-label="Filter by name" />
          </div>
          <button className="icon-btn filled" onClick={() => setSortOpen(true)} aria-label="Sort">
            <Icon name="sort" />
          </button>
          <button className={`icon-btn filled ${activeFilters ? 'active' : ''}`} onClick={() => setFilterOpen(true)} aria-label={`Filters${activeFilters ? `, ${activeFilters} active` : ''}`}>
            <Icon name="filter" />
          </button>
          <button className="icon-btn filled" onClick={() => void updateSettings({ libraryView: s.libraryView === 'grid' ? 'list' : 'grid' })} aria-label={s.libraryView === 'grid' ? 'Show as list' : 'Show as grid'}>
            <Icon name={s.libraryView === 'grid' ? 'list' : 'grid'} />
          </button>
        </div>
        <div className="between">
          <span className="eyebrow">
            {pluralize(shown.length, 'document')} · {SORTS.find((x) => x.value === s.librarySort)?.label}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => (selecting ? done() : setSelecting(true))}>
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon="search" title="No matches" message="Try a different name or clear the filters." action={<button className="btn btn-secondary" onClick={() => (setFilter({}), setText(''))}>Clear filters</button>} />
        ) : s.libraryView === 'grid' ? (
          <div className="doc-grid" style={{ paddingBottom: selecting ? 90 : 0 }}>
            {shown.map((d) => (
              <DocCard key={d.id} doc={d} selecting={selecting} selected={sel.includes(d.id)} onToggle={() => toggle(d.id)} onLongPress={() => startSelect(d.id)} />
            ))}
          </div>
        ) : (
          <div className="list glass" style={{ marginBottom: selecting ? 90 : 0 }}>
            {shown.map((d) => (
              <DocRow key={d.id} doc={d} folder={d.folderId ? folderMap.get(d.folderId) : undefined} selecting={selecting} selected={sel.includes(d.id)} onToggle={() => toggle(d.id)} onLongPress={() => startSelect(d.id)} />
            ))}
          </div>
        )}
      </div>

      {selecting && (
        <div className="select-bar glass-strong" role="toolbar" aria-label={`${sel.length} selected`}>
          <button onClick={() => setSel(sel.length === shown.length ? [] : shown.map((d) => d.id))}>
            <Icon name="select" /> {sel.length === shown.length ? 'None' : 'All'}
          </button>
          <button disabled={!sel.length || busy} onClick={() => void bulkShare()}>
            <Icon name="share" /> Share
          </button>
          <button disabled={!sel.length || busy} onClick={() => setMoveOpen(true)}>
            <Icon name="folderMove" /> Move
          </button>
          <button disabled={!sel.length || busy} onClick={() => void act(async () => { const all = sel.every((id) => docs.find((d) => d.id === id)?.favorite); await setFavorite(sel, !all); })}>
            <Icon name="star" /> Favourite
          </button>
          <button
            disabled={sel.length < 2 || busy}
            onClick={() =>
              void act(async () => {
                const ordered = shown.filter((d) => sel.includes(d.id)).map((d) => d.id);
                const m = await mergeDocuments(ordered, 'Merged document');
                done();
                nav(`/doc/${m.id}`);
              })
            }
          >
            <Icon name="merge" /> Merge
          </button>
          <button
            className="danger"
            disabled={!sel.length || busy}
            onClick={() =>
              void act(async () => {
                const ids = [...sel];
                await moveToTrash(ids);
                done();
                fb.toast(`${pluralize(ids.length, 'document')} moved to Trash`, 'info', { label: 'Undo', run: () => void restoreFromTrash(ids) });
              })
            }
          >
            <Icon name="trash" /> Delete
          </button>
        </div>
      )}

      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title="Sort by">
        <div className="list">
          {SORTS.map((o) => (
            <ListRow key={o.value} label={o.label} onClick={() => (void updateSettings({ librarySort: o.value }), setSortOpen(false))} trailing={s.librarySort === o.value ? <Icon name="check" style={{ color: 'var(--accent)' }} /> : null} />
          ))}
        </div>
      </Sheet>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter">
        <div className="stack" style={{ gap: 16 }}>
          {base.folderId === undefined && (
            <div className="field">
              <span className="field-label">Folder</span>
              <div className="chips">
                <button className="chip" aria-pressed={!filter.folderId || filter.folderId === 'all'} onClick={() => setFilter({ ...filter, folderId: 'all' })}>
                  Any
                </button>
                <button className="chip" aria-pressed={filter.folderId === null} onClick={() => setFilter({ ...filter, folderId: null })}>
                  No folder
                </button>
                {folders.map((f) => (
                  <button key={f.id} className="chip" aria-pressed={filter.folderId === f.id} onClick={() => setFilter({ ...filter, folderId: f.id })}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tags.length > 0 && (
            <div className="field">
              <span className="field-label">Tag</span>
              <div className="chips">
                <button className="chip" aria-pressed={!filter.tagId} onClick={() => setFilter({ ...filter, tagId: null })}>
                  Any
                </button>
                {tags.map((t) => (
                  <button key={t.id} className="chip" aria-pressed={filter.tagId === t.id} onClick={() => setFilter({ ...filter, tagId: t.id })}>
                    <Icon name="tag" /> {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="field">
            <span className="field-label">Text recognition</span>
            <Segmented label="Text recognition" value={filter.ocr ?? 'any'} onChange={(v) => setFilter({ ...filter, ocr: v })} options={[{ value: 'any', label: 'Any' }, { value: 'done', label: 'Searchable' }, { value: 'none', label: 'Not yet' }]} />
          </div>
          <div className="field">
            <span className="field-label">Source</span>
            <Segmented label="Source" value={filter.source ?? 'any'} onChange={(v) => setFilter({ ...filter, source: v })} options={[{ value: 'any', label: 'Any' }, { value: 'camera', label: 'Camera' }, { value: 'image', label: 'Images' }, { value: 'pdf', label: 'PDF' }]} />
          </div>
          {!base.favorite && (
            <ListRow icon="star" label="Favourites only" onClick={() => setFilter({ ...filter, favorite: !filter.favorite })} trailing={filter.favorite ? <Icon name="check" style={{ color: 'var(--accent)' }} /> : null} />
          )}
          <div className="row">
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setFilter({})}>
              Reset
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setFilterOpen(false)}>
              Show {shown.length}
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={moveOpen} onClose={() => setMoveOpen(false)} title={`Move ${pluralize(sel.length, 'document')}`}>
        <FolderPicker
          folders={folders}
          value={undefined as unknown as null}
          onChange={(f) =>
            void act(async () => {
              await moveDocuments(sel, f);
              setMoveOpen(false);
              done();
              fb.toast(f ? `Moved to ${folderMap.get(f)?.name ?? 'folder'}` : 'Removed from folder', 'success');
            })
          }
        />
      </Sheet>
    </>
  );
}
