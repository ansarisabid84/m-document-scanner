import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { getDB } from './db';
import { blobToBase64, isNative, toAppError } from './platform';

/**
 * App-private binary storage for page images.
 *  - Android/iOS: files under the app's private data directory (not visible to other apps,
 *    excluded from Android auto-backup), written temp-file-then-rename for atomicity.
 *  - Web: IndexedDB blobs.
 * Paths are internal references like "pages/<uuid>/original.jpg" — never user-facing.
 */
export interface FileStore {
  write(path: string, blob: Blob): Promise<void>;
  read(path: string): Promise<Blob>;
  url(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  removeDir(prefix: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  usage(): Promise<{ bytes: number; files: number }>;
}

const ROOT = 'ds';

class NativeFileStore implements FileStore {
  private uriCache = new Map<string, string>();

  async write(path: string, blob: Blob): Promise<void> {
    const data = await blobToBase64(blob);
    const tmp = `${ROOT}/${path}.tmp`;
    try {
      await Filesystem.writeFile({ path: tmp, data, directory: Directory.Data, recursive: true });
      await Filesystem.rename({ from: tmp, to: `${ROOT}/${path}`, directory: Directory.Data, toDirectory: Directory.Data });
    } catch (e) {
      await Filesystem.deleteFile({ path: tmp, directory: Directory.Data }).catch(() => undefined);
      throw toAppError(e, 'Could not save the file.');
    }
    this.uriCache.delete(path);
  }

  private async nativeUri(path: string): Promise<string> {
    const cached = this.uriCache.get(path);
    if (cached) return cached;
    const { uri } = await Filesystem.getUri({ path: `${ROOT}/${path}`, directory: Directory.Data });
    const web = Capacitor.convertFileSrc(uri);
    this.uriCache.set(path, web);
    return web;
  }

  async read(path: string): Promise<Blob> {
    const res = await fetch(await this.nativeUri(path));
    if (!res.ok) throw new Error('The file could not be read. It may be missing or damaged.');
    return res.blob();
  }

  url(path: string): Promise<string> {
    return this.nativeUri(path);
  }

  async remove(path: string): Promise<void> {
    this.uriCache.delete(path);
    await Filesystem.deleteFile({ path: `${ROOT}/${path}`, directory: Directory.Data }).catch(() => undefined);
  }

  async removeDir(prefix: string): Promise<void> {
    for (const k of [...this.uriCache.keys()]) if (k.startsWith(prefix)) this.uriCache.delete(k);
    await Filesystem.rmdir({ path: `${ROOT}/${prefix}`, directory: Directory.Data, recursive: true }).catch(() => undefined);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Filesystem.stat({ path: `${ROOT}/${path}`, directory: Directory.Data });
      return true;
    } catch {
      return false;
    }
  }

  async usage(): Promise<{ bytes: number; files: number }> {
    let bytes = 0;
    let files = 0;
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = (await Filesystem.readdir({ path: dir, directory: Directory.Data })).files;
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.type === 'directory') await walk(`${dir}/${e.name}`);
        else {
          bytes += e.size ?? 0;
          files++;
        }
      }
    };
    await walk(ROOT);
    return { bytes, files };
  }
}

class WebFileStore implements FileStore {
  private urls = new Map<string, string>();

  async write(path: string, blob: Blob): Promise<void> {
    const db = await getDB();
    try {
      await db.put('files', blob, path);
    } catch (e) {
      throw toAppError(e, 'Could not save the file.');
    }
    const old = this.urls.get(path);
    if (old) URL.revokeObjectURL(old);
    this.urls.delete(path);
  }

  async read(path: string): Promise<Blob> {
    const blob = await (await getDB()).get('files', path);
    if (!blob) throw new Error('The file could not be found. It may have been deleted.');
    return blob;
  }

  async url(path: string): Promise<string> {
    const c = this.urls.get(path);
    if (c) return c;
    const u = URL.createObjectURL(await this.read(path));
    this.urls.set(path, u);
    return u;
  }

  async remove(path: string): Promise<void> {
    const u = this.urls.get(path);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(path);
    await (await getDB()).delete('files', path);
  }

  async removeDir(prefix: string): Promise<void> {
    const db = await getDB();
    const keys = await db.getAllKeys('files', IDBKeyRange.bound(prefix, `${prefix}￿`));
    const tx = db.transaction('files', 'readwrite');
    for (const k of keys) {
      const u = this.urls.get(k);
      if (u) URL.revokeObjectURL(u);
      this.urls.delete(k);
      void tx.store.delete(k);
    }
    await tx.done;
  }

  async exists(path: string): Promise<boolean> {
    return (await (await getDB()).getKey('files', path)) !== undefined;
  }

  async usage(): Promise<{ bytes: number; files: number }> {
    const db = await getDB();
    let bytes = 0;
    let files = 0;
    let cursor = await db.transaction('files').store.openCursor();
    while (cursor) {
      bytes += cursor.value.size;
      files++;
      cursor = await cursor.continue();
    }
    return { bytes, files };
  }
}

export const fileStore: FileStore = isNative ? new NativeFileStore() : new WebFileStore();
