import { Preferences } from '@capacitor/preferences';
import { SecureStorage, KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { PrivacyScreen } from '@capacitor-community/privacy-screen';
import { isNative } from './platform';
import { cooldownFor } from '../domain/lockPolicy';

/**
 * App-lock secrets.
 *  - The PIN is never stored. We keep PBKDF2-SHA256(pin, random salt) in the iOS Keychain /
 *    Android Keystore-backed storage (this-device-only). The web build falls back to Preferences.
 *  - Failed attempts trigger an escalating cooldown.
 * App lock protects against casual access; it is not a substitute for device encryption.
 */

const PIN_KEY = 'ds.pin.v1';
const ATTEMPTS_KEY = 'ds.lock.attempts';
const ITER = 210_000;

interface PinRecord {
  salt: string;
  hash: string;
  iter: number;
  len: number;
}

let secureReady: Promise<void> | null = null;
function initSecure() {
  if (!secureReady) {
    secureReady = isNative
      ? SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly).catch(() => undefined)
      : Promise.resolve();
  }
  return secureReady;
}

async function secretGet(key: string): Promise<string | null> {
  if (!isNative) return (await Preferences.get({ key })).value;
  await initSecure();
  const v = await SecureStorage.get(key).catch(() => null);
  return typeof v === 'string' ? v : null;
}
async function secretSet(key: string, value: string) {
  if (!isNative) return void (await Preferences.set({ key, value }));
  await initSecure();
  await SecureStorage.set(key, value, false, false);
}
async function secretRemove(key: string) {
  if (!isNative) return void (await Preferences.remove({ key }));
  await initSecure();
  await SecureStorage.remove(key).catch(() => false);
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));

async function derive(pin: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return hex(new Uint8Array(bits));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hasPin(): Promise<boolean> {
  return !!(await secretGet(PIN_KEY));
}

export async function pinLength(): Promise<number> {
  const raw = await secretGet(PIN_KEY);
  if (!raw) return 4;
  try {
    return (JSON.parse(raw) as PinRecord).len || 4;
  } catch {
    return 4;
  }
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4–8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const rec: PinRecord = { salt: hex(salt), hash: await derive(pin, salt, ITER), iter: ITER, len: pin.length };
  await secretSet(PIN_KEY, JSON.stringify(rec));
  await Preferences.remove({ key: ATTEMPTS_KEY });
}

export async function clearPin(): Promise<void> {
  await secretRemove(PIN_KEY);
  await Preferences.remove({ key: ATTEMPTS_KEY });
}

interface AttemptState {
  count: number;
  lockedUntil: number;
}

async function getAttempts(): Promise<AttemptState> {
  const { value } = await Preferences.get({ key: ATTEMPTS_KEY });
  try {
    return value ? (JSON.parse(value) as AttemptState) : { count: 0, lockedUntil: 0 };
  } catch {
    return { count: 0, lockedUntil: 0 };
  }
}


export async function lockoutRemaining(): Promise<number> {
  const a = await getAttempts();
  return Math.max(0, a.lockedUntil - Date.now());
}

export async function verifyPin(pin: string): Promise<{ ok: boolean; waitMs: number }> {
  const a = await getAttempts();
  if (a.lockedUntil > Date.now()) return { ok: false, waitMs: a.lockedUntil - Date.now() };
  const raw = await secretGet(PIN_KEY);
  if (!raw) return { ok: false, waitMs: 0 };
  const rec = JSON.parse(raw) as PinRecord;
  const ok = constantTimeEqual(await derive(pin, unhex(rec.salt), rec.iter), rec.hash);
  if (ok) {
    await Preferences.remove({ key: ATTEMPTS_KEY });
    return { ok: true, waitMs: 0 };
  }
  const count = a.count + 1;
  const wait = cooldownFor(count);
  await Preferences.set({ key: ATTEMPTS_KEY, value: JSON.stringify({ count, lockedUntil: wait ? Date.now() + wait : 0 }) });
  return { ok: false, waitMs: wait };
}

export interface BiometryInfo {
  available: boolean;
  label: string;
}

export async function biometryInfo(): Promise<BiometryInfo> {
  if (!isNative) return { available: false, label: 'Biometrics' };
  try {
    const r = await BiometricAuth.checkBiometry();
    const label =
      r.biometryType === BiometryType.faceId
        ? 'Face ID'
        : r.biometryType === BiometryType.touchId
          ? 'Touch ID'
          : r.biometryType === BiometryType.faceAuthentication
            ? 'Face unlock'
            : 'Fingerprint';
    return { available: r.isAvailable, label };
  } catch {
    return { available: false, label: 'Biometrics' };
  }
}

export async function authenticateBiometric(): Promise<boolean> {
  if (!isNative) return false;
  try {
    await BiometricAuth.authenticate({
      reason: 'Unlock Document Scanner',
      cancelTitle: 'Use PIN',
      allowDeviceCredential: false,
      iosFallbackTitle: 'Use PIN',
      androidTitle: 'Unlock Document Scanner',
      androidSubtitle: 'Confirm it’s you',
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    return false;
  }
}

export async function setSwitcherPrivacy(enabled: boolean): Promise<void> {
  if (!isNative) return;
  try {
    if (enabled) await PrivacyScreen.enable();
    else await PrivacyScreen.disable();
  } catch {
    /* plugin unavailable on this device */
  }
}
