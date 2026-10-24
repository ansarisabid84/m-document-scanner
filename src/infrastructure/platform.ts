import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
export const isIOS = platform === 'ios';
export const isAndroid = platform === 'android';

export function uuid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('Could not read data'));
    r.readAsDataURL(blob);
  });
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Human message for storage exhaustion, used by every write path. */
export function isQuotaError(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return (e as DOMException)?.name === 'QuotaExceededError' || msg.includes('quota') || msg.includes('no space') || msg.includes('enospc') || msg.includes('disk full');
}

export class AppError extends Error {
  constructor(
    public kind: 'storage-full' | 'not-found' | 'corrupt' | 'permission' | 'cancelled' | 'unknown',
    message: string,
  ) {
    super(message);
  }
}

export function toAppError(e: unknown, fallback = 'Something went wrong.'): AppError {
  if (e instanceof AppError) return e;
  if (isQuotaError(e)) return new AppError('storage-full', 'Your device is out of storage. Free up some space and try again — nothing was lost.');
  if ((e as Error)?.name === 'AbortError') return new AppError('cancelled', 'Cancelled.');
  return new AppError('unknown', (e as Error)?.message || fallback);
}
