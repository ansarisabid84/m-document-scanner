import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../../components/Icon';
import { Logo } from '../../components/Logo';
import { DocCard } from '../../components/documents';
import { EmptyState } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { discardDraft, listDocuments, listDrafts, storageStats } from '../../services/library';
import { sortDocuments } from '../../domain/search';
import { formatBytes, formatDate, pluralize } from '../../domain/naming';
import { useFeedback } from '../../app/feedback';
import { useOcrJob } from '../../services/ocr';

const TIPS = [
  'Place pages on a darker, plain surface — edges are found faster and more accurately.',
  'Turn off review in the scanner’s top bar to capture many pages quickly; fix crops later.',
  'Use B & W for text-only pages: crisp output and the smallest files.',
  'Tap “Recognise text” on a document to search inside it, even offline.',
  'Back up regularly from Settings — documents live only on this phone.',
];

const QUICK: { to: string; icon: IconName; label: string }[] = [
  { to: '/import', icon: 'upload', label: 'Import' },
  { to: '/favorites', icon: 'star', label: 'Favourites' },
  { to: '/documents', icon: 'folder', label: 'Folders' },
  { to: '/trash', icon: 'trash', label: 'Trash' },
];

export function Home() {
  const nav = useNavigate();
  const fb = useFeedback();
  const docs = useLive(listDocuments, []);
  const drafts = useLive(listDrafts, []);
  const stats = useLive(storageStats, []);
  const ocr = useOcrJob();
  const recent = useMemo(() => sortDocuments(docs.data ?? [], 'modified').slice(0, 8), [docs.data]);
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const draft = drafts.data?.find((d) => d.sizeBytes > 0);

  return (
    <div className="screen">
      <header className="between" style={{ margin: '10px 4px 18px' }}>
        <div className="row" style={{ gap: 10 }}>
          <Logo size={34} />
          <h1 style={{ fontSize: '1.3rem', whiteSpace: 'nowrap' }}>Document Scanner</h1>
        </div>
        {stats.data && (
          <Link to="/settings/storage" className="stat-pill glass mono" style={{ color: 'inherit', textDecoration: 'none' }} aria-label={`Storage used ${formatBytes(stats.data.bytes)}`}>
            <Icon name="storage" size={14} /> {formatBytes(stats.data.bytes)}
          </Link>
        )}
      </header>

      <div className="stack-lg">
        <section className="hero" aria-label="Start scanning">
          <div className="hero-sheet" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
          <span className="eyebrow" style={{ color: 'rgba(255,255,255,.75)' }}>Offline · Private</span>
          <h2 style={{ marginTop: 6 }}>Scan a document</h2>
          <p>Edges, perspective and lighting are fixed automatically.</p>
          <div className="hero-actions">
            <button className="btn btn-light" onClick={() => nav('/scan')}>
              <Icon name="camera" /> Scan
            </button>
            <button className="btn btn-glass" onClick={() => nav('/import')}>
              <Icon name="upload" /> Import
            </button>
          </div>
        </section>

        {draft && (
          <div className="notice" role="status">
            <Icon name="refresh" />
            <div style={{ flex: 1 }}>
              <strong>Unsaved scan recovered</strong>
              <div className="small muted">
                Started {formatDate(draft.createdAt)}. Your captured pages are safe.
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" onClick={() => nav(`/save/${draft.id}`)}>
                  Resume
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={async () => {
                    if (await fb.confirm({ title: 'Discard this scan?', message: 'The captured pages will be deleted.', confirmLabel: 'Discard', destructive: true })) await discardDraft(draft.id);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}

        {ocr?.status === 'running' && (
          <Link to={`/doc/${ocr.docId}`} className="notice" style={{ color: 'inherit', textDecoration: 'none' }}>
            <Icon name="ocr" />
            <span>
              Recognising text… <span className="mono">{ocr.done}/{ocr.total}</span>
            </span>
          </Link>
        )}

        <nav className="quick-grid" aria-label="Quick actions">
          {QUICK.map((q) => (
            <Link key={q.to} to={q.to} className="quick glass">
              <span className="row-icon">
                <Icon name={q.icon} />
              </span>
              {q.label}
            </Link>
          ))}
        </nav>

        <section className="stack" style={{ gap: 10 }}>
          <div className="between">
            <h2 className="section-title">Recent</h2>
            {(docs.data?.length ?? 0) > 0 && (
              <Link to="/documents" className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }}>
                All {docs.data?.length} <Icon name="chevronRight" size={16} />
              </Link>
            )}
          </div>
          {docs.loading ? null : recent.length === 0 ? (
            <div className="glass" style={{ borderRadius: 'var(--r-lg)' }}>
              <EmptyState
                icon="docs"
                title="No documents yet"
                message="Your scans will appear here. Everything stays on this device."
                action={
                  <button className="btn btn-primary" onClick={() => nav('/scan')}>
                    <Icon name="scan" /> Scan now
                  </button>
                }
              />
            </div>
          ) : (
            <div className="recent-strip">
              {recent.map((d) => (
                <DocCard key={d.id} doc={d} />
              ))}
            </div>
          )}
        </section>

        <section className="glass card row" style={{ alignItems: 'flex-start', gap: 14 }}>
          <span className="row-icon warning">
            <Icon name="sparkles" />
          </span>
          <div>
            <div className="eyebrow">Tip</div>
            <p style={{ marginTop: 4 }}>{tip}</p>
          </div>
        </section>

        {stats.data && stats.data.documents > 0 && (
          <p className="small faint mono" style={{ textAlign: 'center' }}>
            {pluralize(stats.data.documents, 'document')} · {formatBytes(stats.data.bytes)} on this device
          </p>
        )}
      </div>
    </div>
  );
}
