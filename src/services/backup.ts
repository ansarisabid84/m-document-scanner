import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import {
  BACKUP_FORMAT,
  BackupError,
  MANIFEST_VERSION,
  decryptBackup,
  encryptBackup,
  sha256Hex,
  validateManifest,
  type BackupFileEntry,
  type BackupManifest,
} from '../domain/backupFormat';
import type { DocumentRecord, Folder, Page, Tag } from '../domain/models';
import { uniqueTitle } from '../domain/naming';
import { getDB } from '../infrastructure/db';
import { fileStore } from '../infrastructure/fileStore';
import { uuid } from '../infrastructure/platform';
import { deleteDocumentsForever, importRecords, listDocuments, listFolders, listTags, notifyLibraryChanged } from './library';

export const APP_VERSION = '1.0.0';
type Progress = (done: number, total: number, label: string) => void;

/** Builds an encrypted backup of the chosen documents (or all non-deleted documents). */
export async function createBackup(password: string, docIds: string[] | 'all', onProgress: Progress): Promise<Uint8Array> {
  const db = await getDB();
  const allDocs = await listDocuments();
  const docs = docIds === 'all' ? allDocs : allDocs.filter((d) => docIds.includes(d.id));
  if (!docs.length) throw new Error('There are no documents to back up.');
  const pages: Page[] = [];
  for (const d of docs) pages.push(...(await db.getAllFromIndex('pages', 'by-doc', d.id)).filter((p) => p.accepted));
  const folderIds = new Set(docs.map((d) => d.folderId).filter(Boolean));
  const tagIds = new Set(docs.flatMap((d) => d.tagIds));
  const folders = (await listFolders()).filter((f) => docIds === 'all' || folderIds.has(f.id));
  const tags = (await listTags()).filter((t) => docIds === 'all' || tagIds.has(t.id));

  const zip: Zippable = {};
  const files: BackupFileEntry[] = [];
  const paths = pages.flatMap((p) => [p.originalPath, p.processedPath, p.thumbPath].filter((x): x is string => !!x));
  for (const [i, path] of paths.entries()) {
    onProgress(i, paths.length + 2, 'Packing pages');
    const bytes = new Uint8Array(await (await fileStore.read(path)).arrayBuffer());
    files.push({ path, sha256: await sha256Hex(bytes), size: bytes.length });
    zip[`files/${path}`] = [bytes, { level: 0 }];
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: MANIFEST_VERSION,
    createdAt: Date.now(),
    appVersion: APP_VERSION,
    documents: docs,
    pages,
    folders,
    tags,
    files,
  };
  zip['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  onProgress(paths.length, paths.length + 2, 'Compressing');
  const archive = zipSync(zip);
  onProgress(paths.length + 1, paths.length + 2, 'Encrypting');
  const enc = await encryptBackup(archive, password);
  onProgress(paths.length + 2, paths.length + 2, 'Done');
  return enc;
}

export interface RestorePreview {
  manifest: BackupManifest;
  entries: Record<string, Uint8Array>;
  corruptFiles: string[];
}

/** Decrypts and fully validates a backup without touching the library. */
export async function openBackup(data: Uint8Array, password: string, onProgress: Progress): Promise<RestorePreview> {
  onProgress(0, 3, 'Decrypting');
  const zipBytes = await decryptBackup(data, password);
  onProgress(1, 3, 'Reading archive');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new BackupError('corrupt', 'The backup archive is damaged and cannot be read.');
  }
  const raw = entries['manifest.json'];
  if (!raw) throw new BackupError('manifest', 'The backup has no manifest.');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as BackupManifest;
  } catch {
    throw new BackupError('manifest', 'The backup manifest is damaged.');
  }
  const errs = validateManifest(manifest);
  if (errs.length) throw new BackupError('manifest', errs[0]);
  onProgress(2, 3, 'Verifying files');
  const corruptFiles: string[] = [];
  for (const f of manifest.files) {
    const bytes = entries[`files/${f.path}`];
    if (!bytes || bytes.length !== f.size || (await sha256Hex(bytes)) !== f.sha256) corruptFiles.push(f.path);
  }
  onProgress(3, 3, 'Verified');
  return { manifest, entries, corruptFiles };
}

export interface RestoreReport {
  documents: number;
  pages: number;
  skippedPages: number;
  skippedDocuments: string[];
}

/**
 * Imports a verified backup.
 *  - merge: adds documents next to existing ones (conflicting IDs get new IDs, titles stay unique).
 *  - replace: imports everything first, and only then removes the previous library.
 * Page images always get fresh internal paths, so existing files are never overwritten.
 */
export async function restoreBackup(preview: RestorePreview, mode: 'merge' | 'replace', onProgress: Progress): Promise<RestoreReport> {
  const { manifest, entries, corruptFiles } = preview;
  const bad = new Set(corruptFiles);
  const db = await getDB();
  const previousDocIds = (await db.getAll('documents')).map((d) => d.id);
  const existingIds = new Set(previousDocIds);
  const existingTitles = mode === 'merge' ? (await listDocuments()).map((d) => d.title) : [];

  // Folders: reuse existing folders with the same id or name.
  const localFolders = await listFolders();
  const folderMap = new Map<string, string>();
  const newFolders: Folder[] = [];
  for (const f of manifest.folders) {
    const same = localFolders.find((l) => l.id === f.id) ?? localFolders.find((l) => l.name.toLowerCase() === f.name.toLowerCase());
    if (same) folderMap.set(f.id, same.id);
    else {
      newFolders.push(f);
      folderMap.set(f.id, f.id);
    }
  }
  // Tags: merge by name.
  const localTags = await listTags();
  const tagMap = new Map<string, string>();
  const newTags: Tag[] = [];
  for (const t of manifest.tags) {
    const same = localTags.find((l) => l.name.toLowerCase() === t.name.toLowerCase());
    if (same) tagMap.set(t.id, same.id);
    else {
      const id = localTags.some((l) => l.id === t.id) ? uuid() : t.id;
      newTags.push({ ...t, id });
      tagMap.set(t.id, id);
    }
  }

  const outDocs: DocumentRecord[] = [];
  const outPages: Page[] = [];
  const skippedDocuments: string[] = [];
  let skippedPages = 0;
  const total = manifest.pages.length;
  let done = 0;
  for (const doc of manifest.documents) {
    const docPages = manifest.pages.filter((p) => p.documentId === doc.id).sort((a, b) => a.position - b.position);
    const docId = existingIds.has(doc.id) ? uuid() : doc.id;
    const kept: Page[] = [];
    for (const p of docPages) {
      onProgress(done++, total, 'Restoring pages');
      if (bad.has(p.originalPath)) {
        skippedPages++;
        continue;
      }
      const pid = uuid();
      const remap = async (path: string | null, name: string) => {
        if (!path || bad.has(path) || !entries[`files/${path}`]) return null;
        const dst = `pages/${pid}/${name}`;
        await fileStore.write(dst, new Blob([entries[`files/${path}`] as BlobPart], { type: 'image/jpeg' }));
        return dst;
      };
      const v = Date.now().toString(36);
      const originalPath = (await remap(p.originalPath, 'original.jpg'))!;
      const processedPath = await remap(p.processedPath, `processed-${v}.jpg`);
      const thumbPath = await remap(p.thumbPath, `thumb-${v}.jpg`);
      kept.push({ ...p, id: pid, documentId: docId, position: kept.length, originalPath, processedPath, thumbPath, accepted: true });
    }
    if (!kept.length) {
      skippedDocuments.push(doc.title);
      continue;
    }
    const title = mode === 'merge' ? uniqueTitle(doc.title, existingTitles) : doc.title;
    existingTitles.push(title);
    outPages.push(...kept);
    outDocs.push({
      ...doc,
      id: docId,
      title,
      folderId: doc.folderId ? (folderMap.get(doc.folderId) ?? null) : null,
      tagIds: doc.tagIds.map((t) => tagMap.get(t)).filter((t): t is string => !!t),
      draft: false,
      pageCount: kept.length,
      thumbPath: kept[0].thumbPath,
    });
  }
  await importRecords({ documents: outDocs, pages: outPages, folders: newFolders, tags: newTags });
  // Pages with a missing processed image are re-rendered lazily by the viewer; mark for OCR consistency.
  if (mode === 'replace') {
    const keep = new Set(outDocs.map((d) => d.id));
    await deleteDocumentsForever(previousDocIds.filter((id) => !keep.has(id)));
  }
  notifyLibraryChanged();
  return { documents: outDocs.length, pages: outPages.length, skippedPages, skippedDocuments };
}

export function backupFileName(date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return `Document Scanner backup ${d}.dsbackup`;
}
