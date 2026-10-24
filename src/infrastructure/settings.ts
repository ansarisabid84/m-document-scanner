import { Preferences } from '@capacitor/preferences';
import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, type AppSettings } from '../domain/models';

/** Non-secret preferences. Secrets (PIN hash) live in secure storage — see security.ts. */
const KEY = 'settings.v1';
let current: AppSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<() => void>();

export async function loadSettings(): Promise<AppSettings> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) current = { ...DEFAULT_SETTINGS, ...(JSON.parse(value) as Partial<AppSettings>) };
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  listeners.forEach((l) => l());
  return current;
}

export function getSettings(): AppSettings {
  return current;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  current = { ...current, ...patch };
  listeners.forEach((l) => l());
  await Preferences.set({ key: KEY, value: JSON.stringify(current) });
}

export async function resetSettings(): Promise<void> {
  current = { ...DEFAULT_SETTINGS, onboarded: true };
  listeners.forEach((l) => l());
  await Preferences.set({ key: KEY, value: JSON.stringify(current) });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getSettings, getSettings);
}
