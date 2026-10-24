import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { EmptyState, Thumb } from '../../components/ui';
import { useLive } from '../../hooks/useLive';
import { allPagesByDoc, listDocuments, listTags } from '../../services/library';
import { searchDocuments } from '../../domain/search';
import { pluralize } from '../../domain/naming';

const RECENT_KEY = 'ds.recentSearches';

function loadRecent(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Local full-text search over titles, tags and recognised text. Queries never leave the device. */
export default function Search() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const docs = useLive(listDocuments, []);
  const pages = useLive(allPagesByDoc, []);
  const tags = useLive(listTags, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 160);
    return () => clearTimeout(t);
  }, [q]);

  const hits = useMemo(() => (docs.data && pages.data ? searchDocuments(debounced, docs.data, pages.data, tags.data ?? []) : []), [debounced, docs.data, pages.data, tags.data]);
  const unreadCount = (docs.data ?? []).filter((d) => d.ocrStatus !== 'done').length;

  const remember = () => {
    const v = q.trim();
    if (!v) return;
    const next = [v, ...recent.filter((r) => r !== v)].slice(0, 6);
    setRecent(next);
    sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  return (
    <div className="screen">
      <h1 className="large-title">Search</h1>
      <form
        className="search-field"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          remember();
        }}
      >
        <Icon name="search" />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Titles, tags and text in your scans" aria-label="Search documents" autoFocus enterKeyHint="search" />
      </form>
      <p className="tiny muted" style={{ margin: '8px 6px 18px' }}>
        <Icon name="shield" size={12} /> Search runs entirely on this device.
      </p>

      {!debounced.trim() ? (
        <div className="stack-lg">
          {recent.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="section-title">Recent</h2>
              <div className="chips">
                {recent.map((r) => (
                  <button key={r} className="chip" onClick={() => setQ(r)}>
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}
          <EmptyState icon="search" title="Find anything you’ve scanned" message={unreadCount > 0 ? `${pluralize(unreadCount, 'document')} ${unreadCount === 1 ? 'hasn’t' : 'haven’t'} had text recognised yet — open one and tap “Recognise text” to search inside it.` : 'Search by name, tag, or any word on the page.'} />
        </div>
      ) : hits.length === 0 ? (
        <EmptyState icon="search" title="No results" message={`Nothing matches “${debounced}”. Check the spelling, or recognise text on more documents.`} />
      ) : (
        <div className="stack">
          <span className="eyebrow">{pluralize(hits.length, 'result')}</span>
          {hits.map((h) => (
            <div key={h.doc.id} className="glass card stack" style={{ gap: 10, padding: 12 }}>
              <Link to={`/doc/${h.doc.id}`} className="row" style={{ color: 'inherit', textDecoration: 'none', gap: 12 }} onClick={remember}>
                <Thumb path={h.doc.thumbPath} alt="" className="doc-row-thumb" />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block' }}>{h.doc.title}</strong>
                  <span className="tiny muted mono">
                    {pluralize(h.doc.pageCount, 'page')}
                    {h.matchedTags.length ? ` · tag: ${h.matchedTags.join(', ')}` : ''}
                    {h.pageMatches.length ? ` · ${pluralize(h.pageMatches.length, 'page match', 'page matches')}` : ''}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} style={{ color: 'var(--text-faint)' }} />
              </Link>
              {h.pageMatches.slice(0, 3).map((m) => (
                <Link key={m.pageId} to={`/doc/${h.doc.id}/view/${m.position}?q=${encodeURIComponent(debounced)}`} className="snippet small" style={{ color: 'inherit', textDecoration: 'none', padding: '8px 10px', borderRadius: 12, background: 'var(--surface-sunken)' }} onClick={remember}>
                  <span className="mono tiny muted">p.{m.position + 1} </span>
                  {m.snippet.map((part, i) => (part.mark ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>))}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
