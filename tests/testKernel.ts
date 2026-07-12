// tests/testKernel.ts — test kernel factory.
// Injects an in-memory settings store into the same wiring as production
// (makeKernel). Tests that want to verify saved contents build and pass
// their own storage.

import { makeKernel } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage, type SettingsStorage } from '../src/infrastructure/settingsStore';

export function makeTestKernel(storage: SettingsStorage = memoryStorage()) {
  return makeKernel({ settingsStore: makeSettingsStore(storage) }).kernel;
}
