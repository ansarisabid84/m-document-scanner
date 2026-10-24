import { Link, NavLink, useNavigate } from 'react-router-dom';
import type { DocumentRecord, Folder } from '../domain/models';
import { formatBytes, formatDate, formatShortDate, pluralize } from '../domain/naming';
import { Icon } from './Icon';
import { Thumb } from './ui';
import { tap } from '../infrastructure/haptics';

function ocrBadge(d: DocumentRecord) {
  if (d.ocrStatus === 'done') return <span className="badge success" title="Text recognised"><Icon name="text" /> Text</span>;
  if (d.ocrStatus === 'running') return <span className="badge accent">Reading…</span>;
  return null;
}

export function DocCard({
  doc,
  selecting,
  selected,
  onToggle,
  onLongPress,
}: {
  doc: DocumentRecord;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onLongPress?: () => void;
}) {
  const nav = useNavigate();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let long = false;
  return (
    <button
      type="button"
      className="doc-card"
      aria-selected={selecting ? selected : undefined}
      aria-label={`${doc.title}, ${pluralize(doc.pageCount, 'page')}${doc.favorite ? ', favourite' : ''}`}
      onPointerDown={() => {
        long = false;
        if (onLongPress)
          timer = setTimeout(() => {
            long = true;
            tap('medium');
            onLongPress();
          }, 480);
      }}
      onPointerUp={() => clearTimeout(timer)}
      onPointerLeave={() => clearTimeout(timer)}
      onContextMenu={(e) => {
        if (onLongPress) {
          e.preventDefault();
        }
      }}
      onClick={() => {
        if (long) return;
        if (selecting) onToggle?.();
        else nav(`/doc/${doc.id}`);
      }}
    >
      <div style={{ position: 'relative' }}>
        <Thumb path={doc.thumbPath} alt="" />
        {doc.ocrStatus === 'done' && (
          <span className="badge success ocr-flag" title="Text recognised">
            <Icon name="text" /> Text
          </span>
        )}
      </div>
      {doc.favorite && (
        <span className="fav">
          <Icon name="star" filled size={18} />
        </span>
      )}
      {selecting && (
        <span className="check">
          <Icon name="check" size={16} />
        </span>
      )}
      <span className="title">{doc.title}</span>
      <span className="meta mono">
        {doc.pageCount}p · {formatShortDate(doc.updatedAt)}
      </span>
    </button>
  );
}

export function DocRow({ doc, selecting, selected, onToggle, onLongPress, folder }: { doc: DocumentRecord; selecting?: boolean; selected?: boolean; onToggle?: () => void; onLongPress?: () => void; folder?: Folder }) {
  const nav = useNavigate();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let long = false;
  return (
    <button
      type="button"
      className="list-row"
      aria-selected={selecting ? selected : undefined}
      onPointerDown={() => {
        long = false;
        if (onLongPress)
          timer = setTimeout(() => {
            long = true;
            tap('medium');
            onLongPress();
          }, 480);
      }}
      onPointerUp={() => clearTimeout(timer)}
      onPointerLeave={() => clearTimeout(timer)}
      onClick={() => {
        if (long) return;
        if (selecting) onToggle?.();
        else nav(`/doc/${doc.id}`);
      }}
    >
      {selecting && (
        <span className="row-icon" style={selected ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--surface-sunken)', color: 'transparent' }}>
          <Icon name="check" />
        </span>
      )}
      <Thumb path={doc.thumbPath} alt="" className="doc-row-thumb" />
      <span className="grow">
        <span className="label row" style={{ gap: 6 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
          {doc.favorite && <Icon name="star" filled size={14} style={{ color: '#f5b301' }} />}
        </span>
        <span className="detail mono tiny" style={{ display: 'block' }}>
          {pluralize(doc.pageCount, 'page')} · {formatBytes(doc.sizeBytes)} · {formatDate(doc.updatedAt)}
          {folder ? ` · ${folder.name}` : ''}
        </span>
      </span>
      {ocrBadge(doc)}
    </button>
  );
}

export function BottomNav({ onScan }: { onScan: () => void }) {
  const items = [
    { to: '/', icon: 'home' as const, label: 'Home', end: true },
    { to: '/documents', icon: 'docs' as const, label: 'Documents' },
    null,
    { to: '/search', icon: 'search' as const, label: 'Search' },
    { to: '/settings', icon: 'settings' as const, label: 'Settings' },
  ];
  return (
    <nav className="bottom-nav glass-strong" aria-label="Main">
      {items.map((it) =>
        it ? (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <Icon name={it.icon} />
            <span>{it.label}</span>
          </NavLink>
        ) : (
          <button key="scan" className="scan-fab" onClick={onScan} aria-label="Scan a document">
            <Icon name="scan" />
          </button>
        ),
      )}
    </nav>
  );
}

export function FolderTile({ folder, count }: { folder: Folder; count: number }) {
  return (
    <Link to={`/folder/${folder.id}`} className="folder-tile">
      <span className="row-icon" style={{ background: `${folder.color}22`, color: folder.color }}>
        <Icon name={(folder.icon as never) ?? 'folder'} />
      </span>
      <span className="name">{folder.name}</span>
      <span className="mono tiny muted">{pluralize(count, 'doc')}</span>
    </Link>
  );
}
