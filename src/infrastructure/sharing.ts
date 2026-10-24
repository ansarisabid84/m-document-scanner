import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { blobToBase64, isAndroid, isNative, toAppError } from './platform';

/**
 * Hands exported files to the user. Exports are generated locally, then either
 *  - shared through the native share sheet (Files, Drive, Mail, WhatsApp, printers…), or
 *  - saved into the device's Documents/Document Scanner folder (Android), or downloaded (web).
 * Once a copy leaves the app, its protection is controlled by the destination app.
 */

export interface OutFile {
  blob: Blob;
  name: string;
}

async function writeCache(file: OutFile): Promise<string> {
  const path = `exports/${Date.now()}-${file.name}`;
  const res = await Filesystem.writeFile({ path, data: await blobToBase64(file.blob), directory: Directory.Cache, recursive: true });
  return res.uri;
}

/** Removes temporary export copies older than an hour (they only exist to feed the share sheet). */
export async function cleanExportCache(): Promise<void> {
  if (!isNative) return;
  try {
    const { files } = await Filesystem.readdir({ path: 'exports', directory: Directory.Cache });
    const cutoff = Date.now() - 3600_000;
    for (const f of files) if ((f.mtime ?? 0) < cutoff) await Filesystem.deleteFile({ path: `exports/${f.name}`, directory: Directory.Cache }).catch(() => undefined);
  } catch {
    /* nothing cached */
  }
}

export async function shareFiles(files: OutFile[], title: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  try {
    if (isNative) {
      const uris: string[] = [];
      for (const f of files) uris.push(await writeCache(f));
      await Share.share({ title, files: uris, dialogTitle: title });
      return 'shared';
    }
    const webFiles = files.map((f) => new File([f.blob], f.name, { type: f.blob.type }));
    if (navigator.canShare?.({ files: webFiles })) {
      await navigator.share({ files: webFiles, title });
      return 'shared';
    }
    files.forEach(download);
    return 'downloaded';
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase();
    if (msg.includes('cancel') || (e as Error)?.name === 'AbortError') return 'cancelled';
    throw toAppError(e, 'Sharing failed.');
  }
}

export function download(f: OutFile) {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const canSaveToDevice = isAndroid || !isNative;

/** Saves without overwriting: "Invoice.pdf" → "Invoice (2).pdf" if needed. Returns a user-facing location. */
export async function saveToDevice(files: OutFile[]): Promise<string> {
  if (!isNative) {
    files.forEach(download);
    return 'your Downloads folder';
  }
  if (!isAndroid) throw new Error('Use Share → Save to Files on iOS.');
  try {
    const perm = await Filesystem.checkPermissions();
    if (perm.publicStorage !== 'granted') await Filesystem.requestPermissions();
  } catch {
    /* Android 10+ does not need the legacy permission */
  }
  for (const f of files) {
    const dot = f.name.lastIndexOf('.');
    const base = dot > 0 ? f.name.slice(0, dot) : f.name;
    const ext = dot > 0 ? f.name.slice(dot) : '';
    let name = f.name;
    for (let n = 2; n < 500; n++) {
      try {
        await Filesystem.stat({ path: `Document Scanner/${name}`, directory: Directory.Documents });
        name = `${base} (${n})${ext}`;
      } catch {
        break;
      }
    }
    try {
      await Filesystem.writeFile({
        path: `Document Scanner/${name}`,
        data: await blobToBase64(f.blob),
        directory: Directory.Documents,
        recursive: true,
      });
    } catch (e) {
      throw toAppError(e, 'Could not save to Documents. Try Share instead.');
    }
  }
  return 'Documents › Document Scanner';
}
