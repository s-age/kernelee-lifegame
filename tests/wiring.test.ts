// WiringTests — wiring completeness smoke test.
// Pins that every symbol id derived from the spec (the single denominator) appears in boundSymbolIds.

import { KernelBuilder } from '@s-age/kernelee';
import { describe, expect, it } from 'vitest';
import { LifePort, SettingsPort, SettingsStorePort, SimPort } from '../src/contract/ports';
import { GridState } from '../src/contract/states';
import { makeKernel, wireAllDevices } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';

/** Enumerate symbol ids from a callable object (keys other than wire / __spec). */
function symbolIds(callable: object): string[] {
  return Object.values(callable)
    .filter((value): value is { id: string } => typeof value === 'object' && value !== null && 'id' in value)
    .map((value) => value.id);
}

describe('wireAllDevices', () => {
  it('every port symbol id is covered by boundSymbolIds', () => {
    const builder = new KernelBuilder();
    wireAllDevices(builder, { settingsStore: makeSettingsStore(memoryStorage()) });

    const expected = [
      ...symbolIds(LifePort),
      ...symbolIds(SimPort),
      ...symbolIds(SettingsPort),
      ...symbolIds(SettingsStorePort),
    ];
    expect(expected.length).toBeGreaterThan(0);
    for (const id of expected) {
      expect(builder.boundSymbolIds.has(id), `missing binding: ${id}`).toBe(true);
    }
    // The reverse direction: everything wired comes from the ports (no hand-minted symbols slipped in).
    expect([...builder.boundSymbolIds].sort()).toEqual([...expected].sort());
  });

  it('makeKernel allocates state, and calls via a port go through', async () => {
    const { kernel } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) });
    const grid = kernel.buffer.read(GridState);
    expect(grid.cells.length).toBe(grid.width * grid.height);
    expect(grid.generation).toBe(0);

    // End to end: kernel.call → LifePort.stepIndexRange (an empty board is still empty one generation later).
    const out = await kernel.call(LifePort.stepIndexRange, {
      cells: grid.cells,
      width: grid.width,
      height: grid.height,
      start: 0,
      end: grid.width * grid.height,
    });
    expect(out.length).toBe(grid.cells.length);
    expect(out.every((cell) => cell === 0)).toBe(true);
  });
});
