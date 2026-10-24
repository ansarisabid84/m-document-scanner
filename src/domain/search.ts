import type { DocumentRecord, Page, SortKey, Tag } from './models';

export interface SearchHit {
  doc: DocumentRecord;
  score: number;
  matchedTitle: boolean;
  matchedTags: string[];
  pageMatches: { pageId: string; position: number; snippet: SnippetPart[] }[];
}

export type SnippetPart = { text: string; mark: boolean };

/** Case- and accent-insensitive normalisation used for local search. */
export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function tokenize(query: string): string[] {
  return normalize(query)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Builds a highlighted snippet around the first occurrence of any term. */
export function makeSnippet(text: string, terms: string[], radius = 48): SnippetPart[] | null {
  if (!text || terms.length === 0) return null;
  const norm = normalize(text);
  // normalize() can change string length for some scripts; fall back to identity mapping when it does.
  const source = norm.length === text.length ? text : norm;
  let first = -1;
  for (const t of terms) {
    const i = norm.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  if (first < 0) return null;
  let start = Math.max(0, first - radius);
  let end = Math.min(source.length, first + radius * 2);
  if (start > 0) {
    const sp = source.lastIndexOf(' ', start + 8);
    if (sp > start - 12 && sp >= 0) start = sp + 1;
  }
  const window = source.slice(start, end).replace(/\s+/g, ' ');
  const nwin = normalize(window);
  const marks: [number, number][] = [];
  for (const t of terms) {
    let i = nwin.indexOf(t);
    while (i >= 0) {
      marks.push([i, i + t.length]);
      i = nwin.indexOf(t, i + t.length);
    }
  }
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([...m]);
  }
  const parts: SnippetPart[] = [];
  let cur = 0;
  if (start > 0) parts.push({ text: '…', mark: false });
  for (const [a, b] of merged) {
    if (a > cur) parts.push({ text: window.slice(cur, a), mark: false });
    parts.push({ text: window.slice(a, b), mark: true });
    cur = b;
  }
  if (cur < window.length) parts.push({ text: window.slice(cur), mark: false });
  if (end < source.length) parts.push({ text: '…', mark: false });
  return parts;
}

/**
 * Local full-text search across title, tags and OCR text. All terms must match somewhere in the document.
 * Nothing leaves the device.
 */
export function searchDocuments(
  query: string,
  docs: DocumentRecord[],
  pagesByDoc: Map<string, Page[]>,
  tags: Tag[],
): SearchHit[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    if (doc.deletedAt || doc.draft) continue;
    const title = normalize(doc.title);
    const docTags = doc.tagIds.map((id) => tagName.get(id)).filter((t): t is string => !!t);
    const tagText = normalize(docTags.join(' '));
    const pages = pagesByDoc.get(doc.id) ?? [];
    const pageTexts = pages.map((p) => normalize(p.ocrText ?? ''));
    const all = [title, tagText, ...pageTexts].join('\n');
    if (!terms.every((t) => all.includes(t))) continue;

    const matchedTitle = terms.some((t) => title.includes(t));
    const matchedTags = docTags.filter((n) => terms.some((t) => normalize(n).includes(t)));
    const pageMatches: SearchHit['pageMatches'] = [];
    pages.forEach((p, i) => {
      if (!p.ocrText) return;
      if (!terms.some((t) => pageTexts[i].includes(t))) return;
      const snippet = makeSnippet(p.ocrText, terms);
      if (snippet) pageMatches.push({ pageId: p.id, position: p.position, snippet });
    });
    let score = 0;
    if (matchedTitle) score += 10;
    if (terms.every((t) => title.includes(t))) score += 10;
    if (title.startsWith(terms[0])) score += 5;
    score += matchedTags.length * 4;
    score += Math.min(pageMatches.length, 5) * 2;
    hits.push({ doc, score, matchedTitle, matchedTags, pageMatches });
  }
  return hits.sort((a, b) => b.score - a.score || b.doc.updatedAt - a.doc.updatedAt);
}

export function sortDocuments(docs: DocumentRecord[], key: SortKey): DocumentRecord[] {
  const arr = [...docs];
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  switch (key) {
    case 'oldest':
      return arr.sort((a, b) => a.createdAt - b.createdAt);
    case 'name':
      return arr.sort((a, b) => collator.compare(a.title, b.title));
    case 'size':
      return arr.sort((a, b) => b.sizeBytes - a.sizeBytes);
    case 'modified':
      return arr.sort((a, b) => b.updatedAt - a.updatedAt);
    case 'newest':
    default:
      return arr.sort((a, b) => b.createdAt - a.createdAt);
  }
}

export interface LibraryFilter {
  folderId?: string | null | 'all';
  tagId?: string | null;
  favorite?: boolean;
  ocr?: 'any' | 'done' | 'none';
  source?: 'any' | 'camera' | 'image' | 'pdf';
  text?: string;
}

export function filterDocuments(docs: DocumentRecord[], f: LibraryFilter): DocumentRecord[] {
  const terms = f.text ? tokenize(f.text) : [];
  return docs.filter((d) => {
    if (d.deletedAt || d.draft) return false;
    if (f.folderId !== undefined && f.folderId !== 'all' && d.folderId !== f.folderId) return false;
    if (f.tagId && !d.tagIds.includes(f.tagId)) return false;
    if (f.favorite && !d.favorite) return false;
    if (f.ocr === 'done' && d.ocrStatus !== 'done') return false;
    if (f.ocr === 'none' && d.ocrStatus === 'done') return false;
    if (f.source && f.source !== 'any' && d.sourceType !== f.source) return false;
    if (terms.length && !terms.every((t) => normalize(d.title).includes(t))) return false;
    return true;
  });
}
