import { getDB } from '../infrastructure/db';
import { fileStore } from '../infrastructure/fileStore';
import { AppError, toAppError, uuid } from '../infrastructure/platform';
import {
  DEFAULT_EDITS,
  type DocumentRecord,
  type FilterType,
  type Folder,
  type MarkupOp,
  type OcrStatus,
  type Page,
  type PageEdits,
  type SourceType,
  type Tag,
} from '../domain/models';
import { cleanTitle, suggestTitle, uniqueTitle } from '../domain/naming';
import {
  MAX_ORIGINAL_DIM,
  MAX_PROCESSED_DIM,
  THUMB_DIM,
  canvasToBlob,
  decodeBlob,
  detect,
  drawMarkup,
  imageToCanvas,
  renderEdits,
  scaledCanvas,
  serial,
} from '../imaging/engine';
import { inset, FULL_QUAD } from '../domain/geometry';
import type { RGBAImage } from '../imaging/warp';

/* ───────────────────────────── change notifications ───────────────────────────── */

let version = 0;
const listeners = new Set<() => void>();
export function subscribeLibrary(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function libraryVersion() {
  return version;
}
function emit() {
  version++;
  listeners.forEach((l) => l());
}

/* ───────────────────────────── reads ───────────────────────────── */

export async function listDocuments(includeDeleted = false): Promise<DocumentRecord[]> {
  const all = await (await getDB()).getAll('documents');
  return all.filter((d) => !d.draft && (includeDeleted ? true : !d.deletedAt));
}

export async function listTrash(): Promise<DocumentRecord[]> {
  const all = await (await getDB()).getAll('documents');
  return all.filter((d) => !d.draft && d.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export async function listDrafts(): Promise<DocumentRecord[]> {
  const all = await (await getDB()).getAll('documents');
  return all.filter((d) => d.draft).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<DocumentRecord | undefined> {
  return (await getDB()).get('documents', id);
}

export async function getPages(documentId: string): Promise<Page[]> {
  const pages = await (await getDB()).getAllFromIndex('pages', 'by-doc', documentId);
  return pages.sort((a, b) => a.position - b.position);
}

export async function getPage(id: string): Promise<Page | undefined> {
  return (await getDB()).get('pages', id);
}

export async function allPagesByDoc(): Promise<Map<string, Page[]>> {
  const pages = await (await getDB()).getAll('pages');
  const map = new Map<string, Page[]>();
  for (const p of pages) {
    const arr = map.get(p.documentId) ?? [];
    arr.push(p);
    map.set(p.documentId, arr);
  }
  map.forEach((arr) => arr.sort((a, b) => a.position - b.position));
  return map;
}

export async function listFolders(): Promise<Folder[]> {
  const f = await (await getDB()).getAll('folders');
  return f.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function getFolder(id: string) {
  return (await getDB()).get('folders', id);
}

export async function listTags(): Promise<Tag[]> {
  const t = await (await getDB()).getAll('tags');
  return t.sort((a, b) => a.name.localeCompare(b.name));
}

/* ───────────────────────────── document aggregate ───────────────────────────── */

function aggregateOcr(pages: Page[]): OcrStatus {
  if (pages.length === 0) return 'none';
  if (pages.some((p) => p.ocrStatus === 'running' || p.ocrStatus === 'queued')) return 'running';
  if (pages.every((p) => p.ocrStatus === 'done')) return 'done';
  if (pages.some((p) => p.ocrStatus === 'failed')) return 'failed';
  if (pages.some((p) => p.ocrStatus === 'done' || p.ocrStatus === 'stale')) return 'stale';
  return 'none';
}

export async function recomputeDocument(docId: string, touch = true): Promise<void> {
  const db = await getDB();
  const doc = await db.get('documents', docId);
  if (!doc) return;
  const pages = (await db.getAllFromIndex('pages', 'by-doc', docId)).filter((p) => p.accepted || doc.draft).sort((a, b) => a.position - b.position);
  const accepted = pages.filter((p) => p.accepted);
  doc.pageCount = accepted.length;
  doc.sizeBytes = pages.reduce((s, p) => s + p.sizeBytes, 0);
  doc.thumbPath = accepted[0]?.thumbPath ?? pages[0]?.thumbPath ?? null;
  doc.ocrStatus = aggregateOcr(accepted);
  if (touch) doc.updatedAt = Date.now();
  await db.put('documents', doc);
}

/* ───────────────────────────── scan sessions / drafts ───────────────────────────── */

/** Starts a recoverable scan session. Pages are persisted as they are captured. */
export async function createDraft(sourceType: SourceType): Promise<DocumentRecord> {
  const now = Date.now();
  const doc: DocumentRecord = {
    id: uuid(),
    title: suggestTitle(new Date(now)),
    folderId: null,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    pageCount: 0,
    favorite: false,
    ocrStatus: 'none',
    thumbPath: null,
    deletedAt: null,
    draft: true,
    sourceType,
    sizeBytes: 0,
  };
  await (await getDB()).put('documents', doc);
  emit();
  return doc;
}

export interface SaveDraftInput {
  title: string;
  folderId: string | null;
  tagIds: string[];
  favorite: boolean;
}

export async function finalizeDraft(docId: string, input: SaveDraftInput): Promise<DocumentRecord> {
  const db = await getDB();
  const doc = await db.get('documents', docId);
  if (!doc) throw new AppError('not-found', 'This scan no longer exists.');
  // Drop any page that was captured but never accepted.
  const pages = await db.getAllFromIndex('pages', 'by-doc', docId);
  for (const p of pages.filter((x) => !x.accepted)) await deletePageFiles(p, true);
  const existing = (await listDocuments()).map((d) => d.title);
  doc.title = uniqueTitle(cleanTitle(input.title, suggestTitle()), existing);
  doc.folderId = input.folderId;
  doc.tagIds = input.tagIds;
  doc.favorite = input.favorite;
  doc.draft = false;
  doc.createdAt = Date.now();
  await db.put('documents', doc);
  await renumber(docId);
  await recomputeDocument(docId);
  emit();
  return (await db.get('documents', docId))!;
}

export async function discardDraft(docId: string): Promise<void> {
  const doc = await getDocument(docId);
  if (!doc?.draft) return;
  await deleteDocumentsForever([docId]);
}

/* ───────────────────────────── pages ───────────────────────────── */

function pagePath(pageId: string, name: string) {
  return `pages/${pageId}/${name}`;
}

async function encodeOriginal(img: RGBAImage): Promise<Blob> {
  const c = imageToCanvas(img);
  const b = await canvasToBlob(c, 'image/jpeg', 0.92);
  c.width = c.height = 0;
  return b;
}

/** Detects the page outline on a small copy of the image. */
async function autoQuad(img: RGBAImage) {
  const c = imageToCanvas(img);
  const small = scaledCanvas(c, 360);
  const d = small.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, small.width, small.height);
  c.width = c.height = 0;
  const det = await detect({ data: d.data, width: d.width, height: d.height });
  return det;
}

export interface AddImageOptions {
  filter: FilterType;
  /** Run edge detection to pre-fill the crop (camera/photo). */
  detectEdges: boolean;
  accepted: boolean;
  /** Known crop from the live preview (normalised). */
  quad?: PageEdits['quad'];
}

/** Stores a new original, detects its outline and renders the processed version. */
export function addImagePage(docId: string, blob: Blob, opts: AddImageOptions): Promise<Page> {
  return serial(async () => {
    try {
      const db = await getDB();
      const img = await decodeBlob(blob, MAX_ORIGINAL_DIM);
      const original = await encodeOriginal(img);
      let quad = opts.quad ?? null;
      if (!quad && opts.detectEdges) {
        const det = await autoQuad(img);
        if (det && det.confidence > 0.5) quad = det.quad;
      }
      const id = uuid();
      const now = Date.now();
      const originalPath = pagePath(id, 'original.jpg');
      await fileStore.write(originalPath, original);
      const existing = await db.getAllFromIndex('pages', 'by-doc', docId);
      const page: Page = {
        id,
        documentId: docId,
        position: existing.length ? Math.max(...existing.map((p) => p.position)) + 1 : 0,
        originalPath,
        processedPath: null,
        thumbPath: null,
        width: img.width,
        height: img.height,
        outWidth: img.width,
        outHeight: img.height,
        edits: { ...DEFAULT_EDITS, filter: opts.filter, quad },
        markup: [],
        ocrText: null,
        ocrWords: null,
        ocrLanguage: null,
        ocrStatus: 'none',
        accepted: opts.accepted,
        originalBytes: original.size,
        sizeBytes: original.size,
        createdAt: now,
        updatedAt: now,
      };
      await db.put('pages', page);
      const rendered = await renderAndStore(page, img);
      await recomputeDocument(docId);
      emit();
      return rendered;
    } catch (e) {
      throw toAppError(e, 'Could not add this page.');
    }
  });
}

/** Suggested crop for manual adjustment when detection fails: a slight inset of the full frame. */
export const MANUAL_QUAD = inset(FULL_QUAD, 0.06);

/**
 * Renders processed image + thumbnail from the original and current edits/markup.
 * New files are written first; old versions are deleted only after the record is updated.
 */
async function renderAndStore(page: Page, preDecoded?: RGBAImage): Promise<Page> {
  const db = await getDB();
  const original = preDecoded ?? (await decodeBlob(await fileStore.read(page.originalPath), MAX_ORIGINAL_DIM));
  const out = await renderEdits(original, page.edits, MAX_PROCESSED_DIM);
  const canvas = imageToCanvas(out);
  if (page.markup.length) drawMarkup(canvas.getContext('2d')!, page.markup, canvas.width, canvas.height);
  const processed = await canvasToBlob(canvas, 'image/jpeg', page.edits.filter === 'bw' ? 0.85 : 0.88);
  const thumbC = scaledCanvas(canvas, THUMB_DIM);
  const thumb = await canvasToBlob(thumbC, 'image/jpeg', 0.8);
  canvas.width = canvas.height = 0;
  const v = Date.now().toString(36);
  const processedPath = pagePath(page.id, `processed-${v}.jpg`);
  const thumbPath = pagePath(page.id, `thumb-${v}.jpg`);
  await fileStore.write(processedPath, processed);
  await fileStore.write(thumbPath, thumb);
  const fresh = (await db.get('pages', page.id)) ?? page;
  const oldPaths = [fresh.processedPath, fresh.thumbPath].filter((p): p is string => !!p && p !== processedPath && p !== thumbPath);
  const updated: Page = {
    ...fresh,
    edits: page.edits,
    markup: page.markup,
    processedPath,
    thumbPath,
    outWidth: out.width,
    outHeight: out.height,
    sizeBytes: fresh.originalBytes + processed.size + thumb.size,
    updatedAt: Date.now(),
  };
  await db.put('pages', updated);
  for (const p of oldPaths) await fileStore.remove(p);
  return updated;
}

export function updatePage(pageId: string, patch: { edits?: PageEdits; markup?: MarkupOp[] }): Promise<Page> {
  return serial(async () => {
    const db = await getDB();
    const page = await db.get('pages', pageId);
    if (!page) throw new AppError('not-found', 'This page no longer exists.');
    const next: Page = { ...page, edits: patch.edits ?? page.edits, markup: patch.markup ?? page.markup };
    // Any visual change invalidates OCR. Redactions additionally purge stored text immediately,
    // so redacted words can never resurface in search or in a searchable-PDF text layer.
    const hasRedaction = next.markup.some((m) => m.kind === 'redact');
    if (page.ocrStatus === 'done' || page.ocrStatus === 'stale') next.ocrStatus = 'stale';
    if (hasRedaction) {
      next.ocrText = null;
      next.ocrWords = null;
      next.ocrStatus = 'none';
    }
    await db.put('pages', next);
    try {
      const out = await renderAndStore(next);
      await recomputeDocument(page.documentId);
      emit();
      return out;
    } catch (e) {
      await db.put('pages', page); // roll back metadata; files of the old version are untouched
      emit();
      throw toAppError(e, 'Could not apply the edit.');
    }
  });
}

export async function acceptPage(pageId: string): Promise<void> {
  const db = await getDB();
  const p = await db.get('pages', pageId);
  if (!p) return;
  p.accepted = true;
  await db.put('pages', p);
  await recomputeDocument(p.documentId);
  emit();
}

async function deletePageFiles(page: Page, removeRecord: boolean) {
  if (removeRecord) await (await getDB()).delete('pages', page.id);
  await fileStore.removeDir(`pages/${page.id}`);
}

export async function deletePage(pageId: string): Promise<void> {
  const page = await getPage(pageId);
  if (!page) return;
  await deletePageFiles(page, true);
  await renumber(page.documentId);
  await recomputeDocument(page.documentId);
  emit();
}

async function renumber(docId: string) {
  const db = await getDB();
  const pages = (await db.getAllFromIndex('pages', 'by-doc', docId)).sort((a, b) => a.position - b.position);
  const tx = db.transaction('pages', 'readwrite');
  pages.forEach((p, i) => {
    if (p.position !== i) void tx.store.put({ ...p, position: i });
  });
  await tx.done;
}

export async function reorderPages(docId: string, orderedIds: string[]): Promise<void> {
  const db = await getDB();
  const pages = await db.getAllFromIndex('pages', 'by-doc', docId);
  const pos = new Map(orderedIds.map((id, i) => [id, i]));
  const tx = db.transaction('pages', 'readwrite');
  for (const p of pages) {
    const n = pos.get(p.id);
    if (n !== undefined && n !== p.position) void tx.store.put({ ...p, position: n });
  }
  await tx.done;
  await recomputeDocument(docId);
  emit();
}

async function copyPageInto(page: Page, targetDocId: string, position: number, accepted = true): Promise<Page> {
  const id = uuid();
  const copyFile = async (src: string | null, name: string) => {
    if (!src) return null;
    const dst = pagePath(id, name);
    await fileStore.write(dst, await fileStore.read(src));
    return dst;
  };
  const now = Date.now();
  const v = now.toString(36);
  const np: Page = {
    ...structuredClone(page),
    id,
    documentId: targetDocId,
    position,
    originalPath: (await copyFile(page.originalPath, 'original.jpg'))!,
    processedPath: await copyFile(page.processedPath, `processed-${v}.jpg`),
    thumbPath: await copyFile(page.thumbPath, `thumb-${v}.jpg`),
    accepted,
    createdAt: now,
    updatedAt: now,
  };
  await (await getDB()).put('pages', np);
  return np;
}

export async function duplicatePage(pageId: string): Promise<void> {
  const page = await getPage(pageId);
  if (!page) return;
  const db = await getDB();
  const pages = (await db.getAllFromIndex('pages', 'by-doc', page.documentId)).sort((a, b) => a.position - b.position);
  const tx = db.transaction('pages', 'readwrite');
  for (const p of pages) if (p.position > page.position) void tx.store.put({ ...p, position: p.position + 1 });
  await tx.done;
  await copyPageInto(page, page.documentId, page.position + 1, page.accepted);
  await recomputeDocument(page.documentId);
  emit();
}

export function rotatePage(pageId: string, dir: 1 | -1): Promise<Page> {
  return getPage(pageId).then((p) => {
    if (!p) throw new AppError('not-found', 'This page no longer exists.');
    const rotation = (((p.edits.rotation + dir * 90) % 360) + 360) % 360;
    // Markup was placed on the previous orientation; it is cleared on rotation only if absent.
    return updatePage(pageId, { edits: { ...p.edits, rotation: rotation as PageEdits['rotation'] }, markup: p.markup.length ? rotateMarkup(p.markup, dir) : [] });
  });
}

function rotateMarkup(ops: MarkupOp[], dir: 1 | -1): MarkupOp[] {
  const rp = (x: number, y: number): [number, number] => (dir === 1 ? [1 - y, x] : [y, 1 - x]);
  const rbox = (x: number, y: number, w: number, h: number) => {
    const [ax, ay] = rp(x, y);
    const [bx, by] = rp(x + w, y + h);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  return ops.map((op) => {
    if (op.kind === 'ink') return { ...op, points: op.points.map(([x, y]) => rp(x, y)) };
    if (op.kind === 'text') {
      const [x, y] = rp(op.x, op.y);
      return { ...op, x, y };
    }
    if (op.kind === 'redact') return { ...op, ...rbox(op.x, op.y, op.w, op.h) };
    const b = rbox(op.x, op.y, op.w, op.h);
    return { ...op, ...b };
  });
}

/* ───────────────────────────── documents ───────────────────────────── */

export async function updateDocument(id: string, patch: Partial<Pick<DocumentRecord, 'title' | 'folderId' | 'tagIds' | 'favorite'>>): Promise<void> {
  const db = await getDB();
  const doc = await db.get('documents', id);
  if (!doc) return;
  if (patch.title !== undefined) {
    const others = (await listDocuments()).filter((d) => d.id !== id).map((d) => d.title);
    patch.title = uniqueTitle(cleanTitle(patch.title, doc.title), others);
  }
  await db.put('documents', { ...doc, ...patch, updatedAt: Date.now() });
  emit();
}

export async function setFavorite(ids: string[], favorite: boolean) {
  const db = await getDB();
  for (const id of ids) {
    const d = await db.get('documents', id);
    if (d) await db.put('documents', { ...d, favorite });
  }
  emit();
}

export async function moveDocuments(ids: string[], folderId: string | null) {
  const db = await getDB();
  for (const id of ids) {
    const d = await db.get('documents', id);
    if (d) await db.put('documents', { ...d, folderId, updatedAt: Date.now() });
  }
  emit();
}

export async function moveToTrash(ids: string[]) {
  const db = await getDB();
  const now = Date.now();
  for (const id of ids) {
    const d = await db.get('documents', id);
    if (d) await db.put('documents', { ...d, deletedAt: now });
  }
  emit();
}

export async function restoreFromTrash(ids: string[]) {
  const db = await getDB();
  for (const id of ids) {
    const d = await db.get('documents', id);
    if (d) await db.put('documents', { ...d, deletedAt: null });
  }
  emit();
}

export async function deleteDocumentsForever(ids: string[]) {
  const db = await getDB();
  for (const id of ids) {
    const pages = await db.getAllFromIndex('pages', 'by-doc', id);
    for (const p of pages) await deletePageFiles(p, true);
    await db.delete('documents', id);
  }
  emit();
}

export async function emptyTrash() {
  await deleteDocumentsForever((await listTrash()).map((d) => d.id));
}

export async function purgeExpiredTrash(retentionDays: number) {
  const cutoff = Date.now() - retentionDays * 86400_000;
  const expired = (await listTrash()).filter((d) => (d.deletedAt ?? 0) < cutoff);
  if (expired.length) await deleteDocumentsForever(expired.map((d) => d.id));
}

export async function duplicateDocument(id: string): Promise<DocumentRecord> {
  const db = await getDB();
  const doc = await db.get('documents', id);
  if (!doc) throw new AppError('not-found', 'Document not found.');
  const pages = await getPages(id);
  const now = Date.now();
  const titles = (await listDocuments()).map((d) => d.title);
  const copy: DocumentRecord = { ...doc, id: uuid(), title: uniqueTitle(`${doc.title} copy`, titles), createdAt: now, updatedAt: now };
  await db.put('documents', copy);
  for (const [i, p] of pages.entries()) await copyPageInto(p, copy.id, i);
  await recomputeDocument(copy.id);
  emit();
  return copy;
}

/** Combines documents (in the given order) into a new document. Sources are kept. */
export async function mergeDocuments(ids: string[], title: string): Promise<DocumentRecord> {
  const db = await getDB();
  const now = Date.now();
  const first = await db.get('documents', ids[0]);
  const titles = (await listDocuments()).map((d) => d.title);
  const doc: DocumentRecord = {
    id: uuid(),
    title: uniqueTitle(cleanTitle(title, 'Merged document'), titles),
    folderId: first?.folderId ?? null,
    tagIds: [],
    createdAt: now,
    updatedAt: now,
    pageCount: 0,
    favorite: false,
    ocrStatus: 'none',
    thumbPath: null,
    deletedAt: null,
    draft: false,
    sourceType: first?.sourceType ?? 'camera',
    sizeBytes: 0,
  };
  await db.put('documents', doc);
  let pos = 0;
  for (const id of ids) for (const p of await getPages(id)) if (p.accepted) await copyPageInto(p, doc.id, pos++);
  await recomputeDocument(doc.id);
  emit();
  return doc;
}

/** Moves selected pages out into a new document (split). */
export async function splitPages(docId: string, pageIds: string[]): Promise<DocumentRecord> {
  const db = await getDB();
  const src = await db.get('documents', docId);
  if (!src) throw new AppError('not-found', 'Document not found.');
  const now = Date.now();
  const titles = (await listDocuments()).map((d) => d.title);
  const doc: DocumentRecord = { ...src, id: uuid(), title: uniqueTitle(`${src.title} (part)`, titles), createdAt: now, updatedAt: now, favorite: false };
  await db.put('documents', doc);
  const pages = (await getPages(docId)).filter((p) => pageIds.includes(p.id));
  for (const [i, p] of pages.entries()) await db.put('pages', { ...p, documentId: doc.id, position: i });
  await renumber(docId);
  await recomputeDocument(docId);
  await recomputeDocument(doc.id);
  emit();
  return doc;
}

/* ───────────────────────────── folders & tags ───────────────────────────── */

export async function saveFolder(input: Partial<Folder> & { name: string }): Promise<Folder> {
  const db = await getDB();
  const now = Date.now();
  const existing = input.id ? await db.get('folders', input.id) : undefined;
  const others = (await listFolders()).filter((f) => f.id !== input.id).map((f) => f.name);
  const folder: Folder = {
    id: existing?.id ?? uuid(),
    name: uniqueTitle(cleanTitle(input.name, 'New folder'), others),
    color: input.color ?? existing?.color ?? '#4C5FD5',
    icon: input.icon ?? existing?.icon ?? 'folder',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.put('folders', folder);
  emit();
  return folder;
}

/** Deletes a folder. Its documents are kept and moved to "No folder". */
export async function deleteFolder(id: string) {
  const db = await getDB();
  for (const d of await db.getAll('documents')) if (d.folderId === id) await db.put('documents', { ...d, folderId: null });
  await db.delete('folders', id);
  emit();
}

export async function ensureTag(name: string): Promise<Tag> {
  const clean = cleanTitle(name, '').slice(0, 40);
  if (!clean) throw new Error('Tag name is empty.');
  const tags = await listTags();
  const found = tags.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (found) return found;
  const tag = { id: uuid(), name: clean };
  await (await getDB()).put('tags', tag);
  emit();
  return tag;
}

export async function deleteTag(id: string) {
  const db = await getDB();
  for (const d of await db.getAll('documents')) if (d.tagIds.includes(id)) await db.put('documents', { ...d, tagIds: d.tagIds.filter((t) => t !== id) });
  await db.delete('tags', id);
  emit();
}

/* ───────────────────────────── OCR persistence ───────────────────────────── */

export async function setPageOcr(pageId: string, patch: Partial<Pick<Page, 'ocrText' | 'ocrWords' | 'ocrLanguage' | 'ocrStatus'>>) {
  const db = await getDB();
  const p = await db.get('pages', pageId);
  if (!p) return;
  await db.put('pages', { ...p, ...patch });
  await recomputeDocument(p.documentId, false);
  emit();
}

/* ───────────────────────────── storage ───────────────────────────── */

export async function storageStats() {
  const docs = await (await getDB()).getAll('documents');
  const usage = await fileStore.usage();
  let estimate: { usage?: number; quota?: number } = {};
  try {
    estimate = (await navigator.storage?.estimate?.()) ?? {};
  } catch {
    /* unsupported */
  }
  return {
    documents: docs.filter((d) => !d.draft && !d.deletedAt).length,
    trash: docs.filter((d) => d.deletedAt).length,
    trashBytes: docs.filter((d) => d.deletedAt).reduce((s, d) => s + d.sizeBytes, 0),
    drafts: docs.filter((d) => d.draft).length,
    bytes: usage.bytes,
    files: usage.files,
    quota: estimate.quota,
    largest: docs
      .filter((d) => !d.draft && !d.deletedAt)
      .sort((a, b) => b.sizeBytes - a.sizeBytes)
      .slice(0, 5),
  };
}

/** Removes files no page references (left behind by crashes mid-write). */
export async function cleanOrphanFiles(): Promise<number> {
  const db = await getDB();
  const pages = await db.getAll('pages');
  const known = new Set(pages.flatMap((p) => [p.originalPath, p.processedPath, p.thumbPath].filter(Boolean) as string[]));
  const pageIds = new Set(pages.map((p) => p.id));
  let removed = 0;
  // Web build: walk the blob store. Native: remove directories of pages that no longer exist.
  const keys = (await db.getAllKeys('files')) as string[];
  for (const k of keys) {
    if (!known.has(k)) {
      await fileStore.remove(k);
      removed++;
    }
  }
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { isNative } = await import('../infrastructure/platform');
    if (isNative) {
      const { files } = await Filesystem.readdir({ path: 'ds/pages', directory: Directory.Data });
      for (const f of files) {
        if (f.type === 'directory' && !pageIds.has(f.name)) {
          await fileStore.removeDir(`pages/${f.name}`);
          removed++;
        } else if (f.type === 'directory') {
          const inner = await Filesystem.readdir({ path: `ds/pages/${f.name}`, directory: Directory.Data });
          for (const g of inner.files) {
            const rel = `pages/${f.name}/${g.name}`;
            if (!known.has(rel)) {
              await fileStore.remove(rel);
              removed++;
            }
          }
        }
      }
    }
  } catch {
    /* directory may not exist yet */
  }
  return removed;
}

export async function deleteAllData() {
  const db = await getDB();
  const docs = await db.getAll('documents');
  await deleteDocumentsForever(docs.map((d) => d.id));
  await db.clear('folders');
  await db.clear('tags');
  await db.clear('files');
  await fileStore.removeDir('pages');
  emit();
}

/** Bulk import used by backup restore. */
export async function importRecords(records: { documents: DocumentRecord[]; pages: Page[]; folders: Folder[]; tags: Tag[] }) {
  const db = await getDB();
  const tx = db.transaction(['documents', 'pages', 'folders', 'tags'], 'readwrite');
  for (const f of records.folders) void tx.objectStore('folders').put(f);
  for (const t of records.tags) void tx.objectStore('tags').put(t);
  for (const d of records.documents) void tx.objectStore('documents').put(d);
  for (const p of records.pages) void tx.objectStore('pages').put(p);
  await tx.done;
  emit();
}

export function notifyLibraryChanged() {
  emit();
}

/** Re-renders a page whose processed image is missing (e.g. after an interrupted edit or a restore). */
export async function repairPage(pageId: string): Promise<Page | undefined> {
  const p = await getPage(pageId);
  if (!p) return undefined;
  if (p.processedPath && p.thumbPath && (await fileStore.exists(p.processedPath))) return p;
  return updatePage(pageId, {});
}
