import { describe, expect, it } from 'vitest';
import { filterDocuments, makeSnippet, searchDocuments, sortDocuments } from '../domain/search';
import { DEFAULT_EDITS, type DocumentRecord, type Page } from '../domain/models';

const doc = (id: string, title: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id, title, folderId: null, tagIds: [], createdAt: 1, updatedAt: 1, pageCount: 1, favorite: false, ocrStatus: 'none',
  thumbPath: null, deletedAt: null, draft: false, sourceType: 'camera', sizeBytes: 0, ...extra,
});
const page = (id: string, documentId: string, position: number, ocrText: string | null): Page => ({
  id, documentId, position, originalPath: '', processedPath: '', thumbPath: '', width: 1, height: 1, outWidth: 1, outHeight: 1,
  edits: DEFAULT_EDITS, markup: [], ocrText, ocrWords: null, ocrLanguage: 'eng', ocrStatus: ocrText ? 'done' : 'none',
  accepted: true, originalBytes: 0, sizeBytes: 0, createdAt: 1, updatedAt: 1,
});

describe('search', () => {
  const docs = [doc('a', 'Electricity bill'), doc('b', 'Lease agreement', { tagIds: ['t1'] }), doc('c', 'Trashed bill', { deletedAt: 5 }), doc('d', 'Draft', { draft: true })];
  const pages = new Map([
    ['a', [page('pa', 'a', 0, 'Amount due ₹1,240 by 12 November')]],
    ['b', [page('pb1', 'b', 0, 'This agreement'), page('pb2', 'b', 1, 'Monthly rent payable on the 5th. Security deposit refundable.')]],
  ]);
  const tags = [{ id: 't1', name: 'Housing' }];

  it('finds by title, tag and OCR text and excludes trash/drafts', () => {
    expect(searchDocuments('bill', docs, pages, tags).map((h) => h.doc.id)).toEqual(['a']);
    expect(searchDocuments('housing', docs, pages, tags).map((h) => h.doc.id)).toEqual(['b']);
    const hits = searchDocuments('deposit', docs, pages, tags);
    expect(hits).toHaveLength(1);
    expect(hits[0].pageMatches[0].position).toBe(1);
  });
  it('requires all terms', () => {
    expect(searchDocuments('rent deposit', docs, pages, tags)).toHaveLength(1);
    expect(searchDocuments('rent electricity', docs, pages, tags)).toHaveLength(0);
  });
  it('builds highlighted snippets', () => {
    const s = makeSnippet('Monthly rent payable on the 5th.', ['rent'])!;
    expect(s.find((p) => p.mark)?.text).toBe('rent');
  });
  it('sorts and filters', () => {
    const list = [doc('x', 'b', { createdAt: 2, sizeBytes: 5 }), doc('y', 'A10', { createdAt: 3, sizeBytes: 1 }), doc('z', 'A2', { createdAt: 1, favorite: true, sizeBytes: 9 })];
    expect(sortDocuments(list, 'name').map((d) => d.title)).toEqual(['A2', 'A10', 'b']);
    expect(sortDocuments(list, 'newest').map((d) => d.id)).toEqual(['y', 'x', 'z']);
    expect(sortDocuments(list, 'size').map((d) => d.id)).toEqual(['z', 'x', 'y']);
    expect(filterDocuments(list, { favorite: true }).map((d) => d.id)).toEqual(['z']);
  });
});
