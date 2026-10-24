import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, BackupError, decryptBackup, encryptBackup, sha256Hex, validateManifest } from '../domain/backupFormat';

const FAST = 100_000;

describe('backup container', () => {
  it('round-trips with the right password', async () => {
    const data = new TextEncoder().encode('hello backup');
    const enc = await encryptBackup(data, 'correct horse', FAST);
    expect(new TextDecoder().decode(await decryptBackup(enc, 'correct horse'))).toBe('hello backup');
  });
  it('rejects a wrong password without leaking data', async () => {
    const enc = await encryptBackup(new Uint8Array([1, 2, 3]), 'password-1', FAST);
    await expect(decryptBackup(enc, 'password-2')).rejects.toBeInstanceOf(BackupError);
  });
  it('detects tampering of header or body', async () => {
    const enc = await encryptBackup(new Uint8Array(64), 'password-1', FAST);
    const t1 = enc.slice();
    t1[t1.length - 1] ^= 1;
    await expect(decryptBackup(t1, 'password-1')).rejects.toThrow();
    const t2 = enc.slice();
    t2[20] ^= 1; // salt byte
    await expect(decryptBackup(t2, 'password-1')).rejects.toThrow();
  });
  it('rejects non-backup files', async () => {
    await expect(decryptBackup(new TextEncoder().encode('%PDF-1.7 not a backup at all, really not. '.repeat(4)), 'x')).rejects.toMatchObject({ code: 'bad-magic' });
  });
  it('refuses short passwords', async () => {
    await expect(encryptBackup(new Uint8Array(1), 'short')).rejects.toThrow();
  });
});

describe('manifest validation', () => {
  const sha = async (s: string) => sha256Hex(new TextEncoder().encode(s));
  it('accepts a consistent manifest', async () => {
    const m = {
      format: BACKUP_FORMAT, version: 1, createdAt: 1, appVersion: '1',
      documents: [{ id: 'd1', title: 'Doc' }],
      pages: [{ id: 'p1', documentId: 'd1', originalPath: 'pages/p1/original.jpg' }],
      folders: [], tags: [],
      files: [{ path: 'pages/p1/original.jpg', sha256: await sha('x'), size: 1 }],
    };
    expect(validateManifest(m)).toEqual([]);
  });
  it('flags dangling pages, missing files and unsafe paths', async () => {
    const m = {
      format: BACKUP_FORMAT, version: 1, createdAt: 1, appVersion: '1',
      documents: [],
      pages: [{ id: 'p1', documentId: 'd404', originalPath: 'pages/p1/original.jpg' }],
      folders: [], tags: [],
      files: [{ path: '../etc/passwd', sha256: await sha('x'), size: 1 }],
    };
    const errs = validateManifest(m);
    expect(errs.join(' ')).toMatch(/missing document/);
    expect(errs.join(' ')).toMatch(/unsafe path/);
    expect(errs.join(' ')).toMatch(/missing from the archive/);
  });
  it('rejects unknown formats', () => {
    expect(validateManifest({ format: 'other' })).not.toEqual([]);
    expect(validateManifest(null)).not.toEqual([]);
  });
});
