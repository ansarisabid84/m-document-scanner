import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocumentRecord, Folder, Page, Tag } from '../domain/models';

/**
 * Structured metadata store. IndexedDB is transactional, works fully offline inside the
 * Capacitor WebView and needs no native plugin. Large images are NOT stored here on native
 * platforms — only internal file references (see fileStore.ts).
 * Repositories depend on this module only through services/library.ts, so the backing store
 * can be swapped (e.g. for SQLite) without touching UI code.
 */
interface ScannerDB extends DBSchema {
  documents: { key: string; value: DocumentRecord; indexes: { 'by-updated': number } };
  pages: { key: string; value: Page; indexes: { 'by-doc': string } };
  folders: { key: string; value: Folder };
  tags: { key: string; value: Tag };
  /** Binary payloads on the web build only. */
  files: { key: string; value: Blob };
  meta: { key: string; value: unknown };
}

export const DB_NAME = 'document-scanner';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ScannerDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ScannerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ScannerDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Migrations are cumulative; each block runs once per device.
        if (oldVersion < 1) {
          const docs = db.createObjectStore('documents', { keyPath: 'id' });
          docs.createIndex('by-updated', 'updatedAt');
          const pages = db.createObjectStore('pages', { keyPath: 'id' });
          pages.createIndex('by-doc', 'documentId');
          db.createObjectStore('folders', { keyPath: 'id' });
          db.createObjectStore('tags', { keyPath: 'id' });
          db.createObjectStore('files');
          db.createObjectStore('meta');
        }
      },
      blocked() {
        // Another tab holds an older version open (web only).
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export type { ScannerDB };
