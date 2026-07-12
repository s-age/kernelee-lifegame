// infrastructure/settingsStore.ts — I/O device ring.
//
// Ring rule: imports contract only (no kernelee — leaf handlers do not take a
// kernel). Settings are stored as a JSON string under a single localStorage
// key. No counterpart of flock is needed — localStorage is synchronous and
// single-threaded, and cross-tab sync is the domain of the storage event (out
// of scope for this demo).
//
// The public surface is factory-only. Runtime dependencies (which storage) are
// injected by the composition root — production uses window.localStorage,
// tests use memoryStorage().

import type { SettingsStoreDevice, SimSettings } from '../contract/ports';

/**
 * Minimal structural surface of storage (getItem/setItem). DOM's Storage
 * satisfies it, but it is declared here so contract never depends on DOM types.
 */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key. The default "location" for saved settings. */
const DEFAULT_KEY = 'kernelee-lifegame/settings';

/**
 * Defensive decode: only shape (types, enum membership) is guarded here; range
 * clamping is a Circuit rule. Every invalid input falls to null — settings must
 * never block startup.
 */
function decodeSettings(parsed: unknown): SimSettings | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { genPerSec, granularity } = parsed as Record<string, unknown>;
  if (typeof genPerSec !== 'number') return null;
  if (granularity !== 'chunk' && granularity !== 'row' && granularity !== 'cell') return null;
  return { genPerSec, granularity };
}

/** SettingsStoreDevice factory — only the caller knows the concretes (storage, key). */
export function makeSettingsStore(storage: SettingsStorage, key: string = DEFAULT_KEY): SettingsStoreDevice {
  return {
    load: () => {
      let raw: string | null;
      try {
        raw = storage.getItem(key); // can throw in private mode etc.
      } catch {
        return null;
      }
      if (raw === null) return null;
      try {
        return decodeSettings(JSON.parse(raw));
      } catch {
        return null; // corrupt JSON — continue with defaults (the next save overwrites it)
      }
    },

    save: (settings) => {
      // Whole-value replacement. localStorage.setItem is synchronous, so once
      // this returns the disk is up to date — Circuit's "disk first, then
      // reflect into the buffer" holds.
      storage.setItem(key, JSON.stringify(settings));
    },
  };
}

/**
 * In-memory SettingsStorage (for tests and non-browser environments).
 */
export function memoryStorage(): SettingsStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}
