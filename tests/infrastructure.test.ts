// InfrastructureTests — the settings store (JSON persistence) and its integration with the settings sagas.
// The store alone pins the defensive load (missing/corrupt/wrong shape → null)
// and the roundtrip; via the kernel we pin "setSpeed / setGranularity → save"
// and "hydrateSettings → restore".

import { describe, expect, it } from 'vitest';
import { SettingsPort } from '../src/contract/ports';
import { SimState } from '../src/contract/states';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';
import { makeTestKernel } from './testKernel';

const KEY = 'kernelee-lifegame/settings';

describe('settingsStore (Infrastructure)', () => {
  it('a missing key is null (first launch)', () => {
    const store = makeSettingsStore(memoryStorage());
    expect(store.load(undefined)).toBeNull();
  });

  it('corrupt JSON, wrong types, and unknown granularity are all null (defensive)', () => {
    for (const raw of ['{oops', '42', '{"genPerSec":"fast","granularity":"chunk"}', '{"genPerSec":10,"granularity":"thread"}']) {
      const storage = memoryStorage();
      storage.setItem(KEY, raw);
      expect(makeSettingsStore(storage).load(undefined), raw).toBeNull();
    }
  });

  it('save → load roundtrip (whole-value replacement)', () => {
    const store = makeSettingsStore(memoryStorage());
    store.save({ genPerSec: 30, granularity: 'row' });
    expect(store.load(undefined)).toEqual({ genPerSec: 30, granularity: 'row' });
  });

  it('a storage whose getItem throws still yields null (settings never block startup)', () => {
    const store = makeSettingsStore({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {},
    });
    expect(store.load(undefined)).toBeNull();
  });
});

describe('settings persistence (Circuit ↔ Infrastructure)', () => {
  it('setSpeed / setGranularity save, and the next kernel\'s hydrateSettings restores', async () => {
    const storage = memoryStorage();

    const first = makeTestKernel(storage);
    await first.call(SettingsPort.setSpeed, 42);
    await first.call(SettingsPort.setGranularity, 'cell');
    expect(JSON.parse(storage.getItem(KEY)!)).toEqual({ genPerSec: 42, granularity: 'cell' });

    // "Restart": assemble a new kernel over the same storage (same as the app's startup sequence).
    const second = makeTestKernel(storage);
    await second.call(SettingsPort.hydrateSettings, undefined);
    const sim = second.buffer.read(SimState);
    expect(sim.genPerSec).toBe(42);
    expect(sim.granularity).toBe('cell');
    // The running state (LoopState) is a separate cell from Sim, so it cannot
    // even become a persistence subject (structurally self-evident).
  });

  it('hydrateSettings keeps the defaults when nothing is saved or the data is corrupt', async () => {
    const storage = memoryStorage();
    storage.setItem(KEY, '{broken');
    const kernel = makeTestKernel(storage);
    await kernel.call(SettingsPort.hydrateSettings, undefined);
    const sim = kernel.buffer.read(SimState);
    expect(sim.genPerSec).toBe(10);
    expect(sim.granularity).toBe('chunk');
  });

  it('a hand-edited saved speed also goes through the range rule (clamp) on hydrate', async () => {
    const storage = memoryStorage();
    storage.setItem(KEY, JSON.stringify({ genPerSec: 999999, granularity: 'row' }));
    const kernel = makeTestKernel(storage);
    await kernel.call(SettingsPort.hydrateSettings, undefined);
    const sim = kernel.buffer.read(SimState);
    expect(sim.genPerSec).toBe(1000);
    expect(sim.granularity).toBe('row');
  });
});
