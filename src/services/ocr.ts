import { useSyncExternalStore } from 'react';
import type { OcrWord, Page } from '../domain/models';
import { fileStore } from '../infrastructure/fileStore';
import { getPages, setPageOcr } from './library';

/**
 * On-device OCR (Tesseract, WebAssembly). The engine, worker and English model are bundled
 * in the app (public/ocr) — no image or text ever leaves the device. Extra language models are
 * optional, user-initiated downloads that are cached locally and work offline afterwards.
 * Handwriting is not supported by this engine and is not advertised.
 */

export interface OcrLanguage {
  code: string;
  name: string;
  /** Approximate download size in MB. */
  size: number;
  bundled?: boolean;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: 'eng', name: 'English', size: 2.9, bundled: true },
  { code: 'hin', name: 'Hindi', size: 1.6 },
  { code: 'mar', name: 'Marathi', size: 1.4 },
  { code: 'ben', name: 'Bengali', size: 1.1 },
  { code: 'guj', name: 'Gujarati', size: 1.0 },
  { code: 'tam', name: 'Tamil', size: 1.9 },
  { code: 'tel', name: 'Telugu', size: 1.6 },
  { code: 'kan', name: 'Kannada', size: 2.0 },
  { code: 'mal', name: 'Malayalam', size: 2.1 },
  { code: 'pan', name: 'Punjabi', size: 1.3 },
  { code: 'urd', name: 'Urdu', size: 1.7 },
  { code: 'ara', name: 'Arabic', size: 1.4 },
  { code: 'fra', name: 'French', size: 1.1 },
  { code: 'deu', name: 'German', size: 1.5 },
  { code: 'spa', name: 'Spanish', size: 1.4 },
  { code: 'por', name: 'Portuguese', size: 1.3 },
  { code: 'ita', name: 'Italian', size: 1.6 },
  { code: 'rus', name: 'Russian', size: 2.0 },
  { code: 'chi_sim', name: 'Chinese (Simplified)', size: 2.4 },
  { code: 'jpn', name: 'Japanese', size: 2.4 },
  { code: 'kor', name: 'Korean', size: 1.6 },
];

const CDN = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const CACHE_DB = 'keyval-store';
const CACHE_STORE = 'keyval';

function assetBase() {
  return `${window.location.origin}/ocr`;
}

function cacheOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve) => {
    const open = indexedDB.open(CACHE_DB);
    open.onupgradeneeded = () => open.result.createObjectStore(CACHE_STORE);
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.close();
        resolve(undefined);
        return;
      }
      const req = fn(db.transaction(CACHE_STORE, mode).objectStore(CACHE_STORE));
      req.onsuccess = () => {
        resolve(req.result);
        db.close();
      };
      req.onerror = () => {
        resolve(undefined);
        db.close();
      };
    };
  });
}

export async function isLanguageInstalled(code: string): Promise<boolean> {
  if (OCR_LANGUAGES.find((l) => l.code === code)?.bundled) return true;
  const key = await cacheOp('readonly', (s) => s.getKey(`./${code}.traineddata`));
  return key !== undefined;
}

export async function installedLanguages(): Promise<string[]> {
  const out: string[] = [];
  for (const l of OCR_LANGUAGES) if (await isLanguageInstalled(l.code)) out.push(l.code);
  return out;
}

async function makeWorker(langs: string[], langPath: string, onProgress?: (p: number, status: string) => void) {
  const { createWorker, OEM } = await import('tesseract.js');
  const base = assetBase();
  return createWorker(langs, OEM.LSTM_ONLY, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath,
    gzip: true,
    cacheMethod: 'write',
    workerBlobURL: false,
    logger: (m) => onProgress?.(m.progress ?? 0, m.status ?? ''),
    errorHandler: () => undefined,
  });
}

/** Explicit, optional download of a language model (requires internet once). */
export async function downloadLanguage(code: string, onProgress: (p: number) => void): Promise<void> {
  if (!navigator.onLine) throw new Error('You’re offline. Connect to the internet to download this language. Scanning keeps working without it.');
  const w = await makeWorker([code], `${CDN}/${code}/4.0.0_best_int`, (p, s) => {
    if (s.includes('loading language') || s.includes('loaded language')) onProgress(p);
  });
  await w.terminate();
  if (!(await isLanguageInstalled(code))) throw new Error('The download did not complete. Please try again.');
}

export async function deleteLanguage(code: string): Promise<void> {
  if (OCR_LANGUAGES.find((l) => l.code === code)?.bundled) return;
  await cacheOp('readwrite', (s) => s.delete(`./${code}.traineddata`));
}

/* ───────────────────────────── job manager ───────────────────────────── */

export interface OcrJob {
  docId: string;
  done: number;
  total: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  message?: string;
}

let job: OcrJob | null = null;
let cancelFlag = false;
let activeWorker: { terminate: () => Promise<unknown> } | null = null;
const subs = new Set<() => void>();
const set = (j: OcrJob | null) => {
  job = j;
  subs.forEach((s) => s());
};
export function useOcrJob(): OcrJob | null {
  return useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => job,
    () => job,
  );
}
export function currentOcrJob() {
  return job;
}

export async function cancelOcr() {
  cancelFlag = true;
  await activeWorker?.terminate().catch(() => undefined);
}

function collectWords(data: { blocks?: unknown }, w: number, h: number): OcrWord[] {
  const words: OcrWord[] = [];
  const blocks = (data.blocks ?? []) as { paragraphs: { lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[];
  for (const b of blocks)
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? [])
        for (const wd of l.words ?? []) {
          const t = wd.text?.trim();
          if (!t) continue;
          words.push({ t, x0: wd.bbox.x0 / w, y0: wd.bbox.y0 / h, x1: wd.bbox.x1 / w, y1: wd.bbox.y1 / h });
        }
  return words;
}

/** Recognises text for a document's pages (all pages needing OCR, or `onlyPageIds`). */
export async function runOcr(docId: string, languages: string[], onlyPageIds?: string[]): Promise<void> {
  if (job?.status === 'running') throw new Error('Text recognition is already running. Please wait for it to finish.');
  const langs = [];
  for (const l of languages.length ? languages : ['eng']) if (await isLanguageInstalled(l)) langs.push(l);
  if (!langs.length) throw new Error('No OCR language is installed. Open Settings › Text recognition.');
  const pages: Page[] = (await getPages(docId)).filter((p) => p.accepted && p.processedPath && (onlyPageIds ? onlyPageIds.includes(p.id) : p.ocrStatus !== 'done'));
  if (!pages.length) return;
  cancelFlag = false;
  set({ docId, done: 0, total: pages.length, status: 'running' });
  for (const p of pages) await setPageOcr(p.id, { ocrStatus: 'queued' });
  try {
    const worker = await makeWorker(langs, `${assetBase()}/lang`);
    activeWorker = worker;
    for (const [i, p] of pages.entries()) {
      if (cancelFlag) break;
      await setPageOcr(p.id, { ocrStatus: 'running' });
      try {
        const blob = await fileStore.read(p.processedPath!);
        const { data } = await worker.recognize(blob, {}, { text: true, blocks: true });
        const words = collectWords(data as { blocks?: unknown }, p.outWidth, p.outHeight);
        await setPageOcr(p.id, { ocrText: (data.text ?? '').trim(), ocrWords: words, ocrLanguage: langs.join('+'), ocrStatus: 'done' });
      } catch (e) {
        if (cancelFlag) break;
        await setPageOcr(p.id, { ocrStatus: 'failed' });
        set({ ...(job as OcrJob), message: e instanceof Error ? e.message : 'Recognition failed' });
      }
      set({ ...(job as OcrJob), done: i + 1 });
    }
    await worker.terminate().catch(() => undefined);
    activeWorker = null;
    if (cancelFlag) {
      for (const p of await getPages(docId)) if (p.ocrStatus === 'queued' || p.ocrStatus === 'running') await setPageOcr(p.id, { ocrStatus: 'none' });
      set({ ...(job as OcrJob), status: 'cancelled' });
    } else {
      const failed = (await getPages(docId)).some((p) => p.ocrStatus === 'failed');
      set({ ...(job as OcrJob), status: failed ? 'failed' : 'done' });
    }
  } catch (e) {
    activeWorker = null;
    for (const p of await getPages(docId)) if (p.ocrStatus === 'queued' || p.ocrStatus === 'running') await setPageOcr(p.id, { ocrStatus: 'failed' });
    set({ docId, done: 0, total: pages.length, status: 'failed', message: e instanceof Error ? e.message : 'Text recognition could not start.' });
  }
  setTimeout(() => {
    if (job && job.status !== 'running') set(null);
  }, 4000);
}
