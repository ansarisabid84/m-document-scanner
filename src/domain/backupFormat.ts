import type { DocumentRecord, Folder, Page, Tag } from './models';

/**
 * Encrypted backup container
 *  ┌──────────┬─────────┬────────────────┬──────────┬────────┬──────────────────────────┐
 *  │ "DSCNBAK1"│ ver u8 │ iterations u32 │ salt[16] │ iv[12] │ AES-256-GCM(zip archive) │
 *  └──────────┴─────────┴────────────────┴──────────┴────────┴──────────────────────────┘
 * Key = PBKDF2-HMAC-SHA256(password, salt, iterations). GCM's tag authenticates the whole archive,
 * so a wrong password and a tampered/corrupt file both fail before anything is imported.
 * Inside the zip: manifest.json + files/<internal path>, each file listed with its SHA-256.
 */
export const MAGIC = 'DSCNBAK1';
export const CONTAINER_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const BACKUP_FORMAT = 'document-scanner-backup';
export const MANIFEST_VERSION = 1;

export interface BackupFileEntry {
  path: string;
  sha256: string;
  size: number;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  documents: DocumentRecord[];
  pages: Page[];
  folders: Folder[];
  tags: Tag[];
  files: BackupFileEntry[];
}

export class BackupError extends Error {
  constructor(
    public code: 'bad-magic' | 'bad-version' | 'wrong-password' | 'corrupt' | 'manifest',
    message: string,
  ) {
    super(message);
  }
}

const HEADER_LEN = 8 + 1 + 4 + 16 + 12;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBackup(plain: Uint8Array, password: string, iterations = PBKDF2_ITERATIONS): Promise<Uint8Array> {
  if (password.length < 8) throw new Error('Backup password must be at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const header = new Uint8Array(HEADER_LEN);
  header.set(new TextEncoder().encode(MAGIC), 0);
  header[8] = CONTAINER_VERSION;
  new DataView(header.buffer).setUint32(9, iterations, false);
  header.set(salt, 13);
  header.set(iv, 29);
  // The header is bound as additional authenticated data, so iterations/salt cannot be altered silently.
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource }, key, plain as BufferSource),
  );
  return concat(header, ct);
}

export function readHeader(data: Uint8Array) {
  if (data.length < HEADER_LEN + 16) throw new BackupError('corrupt', 'This file is too small to be a backup.');
  const magic = new TextDecoder().decode(data.slice(0, 8));
  if (magic !== MAGIC) throw new BackupError('bad-magic', 'This file is not a Document Scanner backup.');
  if (data[8] !== CONTAINER_VERSION) throw new BackupError('bad-version', 'This backup was made by a newer version of the app.');
  const iterations = new DataView(data.buffer, data.byteOffset).getUint32(9, false);
  if (iterations < 100_000 || iterations > 10_000_000) throw new BackupError('corrupt', 'Backup header is damaged.');
  return { iterations, salt: data.slice(13, 29), iv: data.slice(29, 41), header: data.slice(0, HEADER_LEN), body: data.slice(HEADER_LEN) };
}

export async function decryptBackup(data: Uint8Array, password: string): Promise<Uint8Array> {
  const h = readHeader(data);
  const key = await deriveKey(password, h.salt, h.iterations);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: h.iv as BufferSource, additionalData: h.header as BufferSource }, key, h.body as BufferSource),
    );
  } catch {
    throw new BackupError('wrong-password', 'The password is incorrect, or the backup file is damaged.');
  }
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Structural validation of a decrypted manifest. Returns a list of problems (empty = valid). */
export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== 'object') return ['Manifest is missing.'];
  const o = m as Record<string, unknown>;
  if (o.format !== BACKUP_FORMAT) errs.push('Unknown backup format.');
  if (!isNum(o.version) || o.version > MANIFEST_VERSION) errs.push('Unsupported manifest version.');
  for (const k of ['documents', 'pages', 'folders', 'tags', 'files']) if (!Array.isArray(o[k])) errs.push(`Missing ${k} list.`);
  if (errs.length) return errs;
  const docs = o.documents as DocumentRecord[];
  const pages = o.pages as Page[];
  const files = o.files as BackupFileEntry[];
  const docIds = new Set<string>();
  for (const d of docs) {
    if (!d || !isStr(d.id) || !isStr(d.title)) errs.push('A document entry is malformed.');
    else docIds.add(d.id);
  }
  const filePaths = new Set(files.map((f) => f?.path));
  for (const f of files) {
    if (!f || !isStr(f.path) || !/^[a-f0-9]{64}$/.test(String(f.sha256)) || !isNum(f.size)) errs.push('A file entry is malformed.');
    else if (f.path.includes('..') || f.path.startsWith('/')) errs.push('A file entry has an unsafe path.');
  }
  for (const p of pages) {
    if (!p || !isStr(p.id) || !isStr(p.documentId) || !isStr(p.originalPath)) {
      errs.push('A page entry is malformed.');
      continue;
    }
    if (!docIds.has(p.documentId)) errs.push('A page refers to a missing document.');
    if (!filePaths.has(p.originalPath)) errs.push('A page image is missing from the archive.');
  }
  return [...new Set(errs)];
}
