// CircuitTests (headless) — verify the tick loop (divert) and the Sim operations by running the whole kernel.
// No UI: driven solely by makeTestKernel (the same wiring as production) + calls via SimPort.

import { BufferBuilder, KernelBuilder, KernelError, KernelErrorState } from '@s-age/kernelee';
import { describe, expect, it, vi } from 'vitest';
import { FaultsPort, LifePort, SettingsPort, SettingsStorePort, SimPort, type LifeDevice } from '../src/contract/ports';
import { GridState, LoopState, SimState, StatsState, StrokeState, WiringDefectState, type ForkGranularity } from '../src/contract/states';
import { lifeDevice } from '../src/compute/device';
import { settingsDevice } from '../src/circuit/settings';
import { simDevice } from '../src/circuit/sim';
import { bindFlows, loopFaultSink } from '../src/driver/wiring';
import { TICK_LOOP_LAUNCH_NOTE } from '../src/circuit/sim/play';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';
import { makeTestKernel } from './testKernel';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Place a horizontal blinker at (1,2)-(3,2). */
async function placeBlinker(kernel: ReturnType<typeof makeTestKernel>): Promise<void> {
  await kernel.call(SimPort.toggleCell, { x: 1, y: 2 });
  await kernel.call(SimPort.toggleCell, { x: 2, y: 2 });
  await kernel.call(SimPort.toggleCell, { x: 3, y: 2 });
}

describe('Circuit.Sim.step', () => {
  it('advances exactly one generation without changing running (the blinker turns vertical)', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);

    await kernel.call(SimPort.step);

    const grid = kernel.buffer.read(GridState);
    expect(grid.generation).toBe(1);
    expect(kernel.buffer.read(LoopState).phase).toBe('idle');
    const alive = new Set<number>();
    grid.cells.forEach((cell, index) => {
      if (cell === 1) alive.add(index);
    });
    // Vertical blinker: (2,1),(2,2),(2,3)
    expect(alive).toEqual(new Set([1 * grid.width + 2, 2 * grid.width + 2, 3 * grid.width + 2]));
  });

  it('step does not launch the loop (generation does not keep growing afterwards)', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SimPort.step);
    await sleep(80);
    expect(kernel.buffer.read(GridState).generation).toBe(1);
  });
});

describe('Circuit.Sim.play — detached loop fault recovery (the .spawn errorSink → onError policy)', () => {
  /** A kernel wired exactly like production (makeKernel), but with a Compute
   * device whose `stepIndexRange` THROWS — so `play`'s detached `.spawn`
   * generation loop faults on its first lap. Its failure routes to the same
   * `onError` policy production uses (`loopFaultSink`). */
  function makeFaultyLoopKernel() {
    const faultyLife: LifeDevice = {
      ...lifeDevice,
      stepIndexRange: () => {
        throw new Error('stepIndexRange exploded');
      },
    };
    const buffer = new BufferBuilder();
    buffer.allocate(GridState);
    buffer.allocate(SimState);
    buffer.allocate(StatsState);
    buffer.allocate(LoopState);
    buffer.allocate(StrokeState);
    const builder = new KernelBuilder();
    LifePort.wire(faultyLife, builder);
    SimPort.wire(simDevice, builder);
    SettingsPort.wire(settingsDevice, builder);
    SettingsStorePort.wire(makeSettingsStore(memoryStorage()), builder);
    bindFlows(builder);
    // eslint-disable-next-line prefer-const -- captured by the onError closure, only invoked at fault time
    let kernel = builder.build({ buffer, onError: loopFaultSink(() => kernel.buffer) });
    return kernel;
  }

  it('a loop fault recovers LoopState to idle AND surfaces on KernelErrorState (no manual .catch)', async () => {
    const kernel = makeFaultyLoopKernel();
    await kernel.call(SettingsPort.setSpeed, 200); // fast laps

    // play arms 'running' and spawns the detached loop; the arm gate returns
    // synchronously, so phase is 'running' immediately even though the loop
    // will fault on its first generation.
    await kernel.call(SimPort.play);
    expect(kernel.buffer.read(LoopState).phase).toBe('running');

    // The detached loop faults → the framework routes the branch failure to the
    // injected onError (loopFaultSink), which resets LoopState→idle so the UI's
    // Play control re-arms, AND writes KernelErrorState (surfacing the fault).
    for (let i = 0; i < 500 && kernel.buffer.read(LoopState).phase !== 'idle'; i += 1) await sleep(1);
    expect(kernel.buffer.read(LoopState).phase).toBe('idle'); // recovered — the OLD settleTickLoopFault behavior
    expect(kernel.buffer.read(KernelErrorState).message).toContain('stepIndexRange exploded');

    // And the loop is genuinely dead — no further generations.
    const gen = kernel.buffer.read(GridState).generation;
    await sleep(30);
    expect(kernel.buffer.read(GridState).generation).toBe(gen);
  });

  it('a non-loop fault does NOT reset LoopState (the reset is gated on the loop source)', () => {
    // Direct check of the onError policy's discriminator: an unrelated command
    // failure must surface on KernelErrorState WITHOUT stopping a running loop.
    const buffer = new BufferBuilder();
    buffer.allocate(LoopState);
    const built = buffer.build();
    built.mutate(LoopState, () => ({ phase: 'running' as const }));
    const sink = loopFaultSink(() => built);
    sink('Circuit.Settings.setSpeed', new Error('disk full')); // a non-loop source
    expect(built.read(LoopState).phase).toBe('running'); // loop untouched
    expect(built.read(KernelErrorState).message).toContain('disk full'); // still surfaced
  });

  it('a KernelError (miswired) goes to WiringDefectState, NOT the domain-error surface — LoopState still recovers', () => {
    const buffer = new BufferBuilder();
    buffer.allocate(LoopState);
    buffer.allocate(WiringDefectState);
    const built = buffer.build();
    built.mutate(LoopState, () => ({ phase: 'running' as const }));
    const sink = loopFaultSink(() => built);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const error = new KernelError('unbound', 'Sim.tick', 'no flow bound for this dispatch key');
    sink(TICK_LOOP_LAUNCH_NOTE, error);

    expect(built.read(LoopState).phase).toBe('idle'); // recovery is unconditional
    expect(built.read(KernelErrorState).message).toBeNull(); // domain surface untouched
    const defect = built.read(WiringDefectState).message;
    expect(defect).toContain(TICK_LOOP_LAUNCH_NOTE);
    expect(defect).toContain('unbound');
    expect(defect).toContain('Sim.tick');
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    consoleSpy.mockRestore();
  });

  it('a domain failure (plain Error) still goes to KernelErrorState — WiringDefectState untouched', () => {
    const buffer = new BufferBuilder();
    buffer.allocate(LoopState);
    buffer.allocate(WiringDefectState);
    const built = buffer.build();
    built.mutate(LoopState, () => ({ phase: 'running' as const }));
    const sink = loopFaultSink(() => built);

    sink(TICK_LOOP_LAUNCH_NOTE, new Error('stepIndexRange exploded'));

    expect(built.read(LoopState).phase).toBe('idle'); // recovered, as before
    expect(built.read(KernelErrorState).message).toContain('stepIndexRange exploded');
    expect(built.read(WiringDefectState).message).toBeNull(); // developer surface untouched
  });

  it('a non-Error unknown still normalizes via String(error) onto KernelErrorState (regression check)', () => {
    const buffer = new BufferBuilder();
    buffer.allocate(LoopState);
    buffer.allocate(WiringDefectState);
    const built = buffer.build();
    const sink = loopFaultSink(() => built);

    sink('Circuit.Settings.setSpeed', 'a thrown string, not an Error');

    expect(built.read(KernelErrorState).message).toContain('a thrown string, not an Error');
    expect(built.read(WiringDefectState).message).toBeNull();
  });
});

describe('Circuit.Sim.play / pause — the divert loop', () => {
  it('play spins the generation loop and pause stops it', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SettingsPort.setSpeed, 200); // 5ms/generation

    await kernel.call(SimPort.play);
    expect(kernel.buffer.read(LoopState).phase).toBe('running');
    await sleep(150);
    await kernel.call(SimPort.pause);
    // pause only drops the phase to 'stopping' synchronously — there is a lag
    // until the loop itself notices at the next lap's switch and settles on
    // 'idle' (the sleep(100) window below).
    expect(kernel.buffer.read(LoopState).phase).toBe('stopping');

    const generationAtPause = kernel.buffer.read(GridState).generation;
    expect(generationAtPause).toBeGreaterThanOrEqual(3); // definitely spun a few laps

    await sleep(100); // wait for the in-flight lap to reach the switch and exit
    expect(kernel.buffer.read(LoopState).phase).toBe('idle'); // settled from 'stopping'
    const settled = kernel.buffer.read(GridState).generation;
    await sleep(150);
    expect(kernel.buffer.read(GridState).generation).toBe(settled); // no longer growing
  });

  it('pause → play re-entry never duplicates the run (verified via the generation growth rate)', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SettingsPort.setSpeed, 100); // 10ms/generation (ideal rate)

    await kernel.call(SimPort.play);
    await sleep(120);
    await kernel.call(SimPort.pause);
    await sleep(100); // wait for the natural stop

    // Restart + multiple plays while running (all should be absorbed by the double-start guard)
    await kernel.call(SimPort.play);
    await kernel.call(SimPort.play);
    await kernel.call(SimPort.play);
    const before = kernel.buffer.read(GridState).generation;
    await sleep(400);
    await kernel.call(SimPort.pause);
    await sleep(100);
    const gained = kernel.buffer.read(GridState).generation - before;

    // A single run ideally does ~40 generations/400ms (actual is below that due
    // to timer granularity). A duplicated run would be ~2x — pin single-run
    // behavior with 1.25x (50) as the upper bound.
    expect(gained).toBeGreaterThanOrEqual(5); // the restart is really spinning
    expect(gained).toBeLessThan(50); // no duplicated run
  });

  it('an immediate play right after pause (without waiting for the natural stop) never duplicates the run — actually stepping into the 50ms-slice window (regression test)', async () => {
    // The test above sleeps(100) after pause before re-playing, longer than
    // tickLoop's 50ms slice, so by re-entry the phase is already 'idle'
    // (naturally stopped) — it never stepped into the window the LoopState
    // unification is meant to protect: "the old loop is still 'stopping' when
    // the next play arrives". Here play follows pause immediately, with no
    // sleep in between — verifying that the old loop flips back to 'running',
    // reuses itself, and never double-launches.
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SettingsPort.setSpeed, 20); // 50ms/generation — one generation as long as a whole slice

    await kernel.call(SimPort.play);
    await sleep(120); // ensure a few generations have definitely run
    await kernel.call(SimPort.pause);
    expect(kernel.buffer.read(LoopState).phase).toBe('stopping'); // not 'idle' yet
    await kernel.call(SimPort.play); // immediate re-entry without waiting for the natural stop — the window itself
    expect(kernel.buffer.read(LoopState).phase).toBe('running'); // the same loop recovered

    const before = kernel.buffer.read(GridState).generation;
    await sleep(400); // ~8 generations at the ideal rate
    await kernel.call(SimPort.pause);
    await sleep(150);
    const gained = kernel.buffer.read(GridState).generation - before;

    expect(gained).toBeGreaterThanOrEqual(3); // really spinning
    expect(gained).toBeLessThan(12); // not a duplicated run (~16 generations)
  });
});

describe('Circuit.Sim.step — entry gate (the invariant is owned by circuit)', () => {
  it('a step while running aborts and the generation does not advance', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    // Only raise the phase without launching the loop (isolated gate verification).
    kernel.buffer.mutate(LoopState, () => ({ phase: 'running' as const }));

    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(GridState).generation).toBe(0); // the gate aborted

    kernel.buffer.mutate(LoopState, () => ({ phase: 'idle' as const }));
    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(GridState).generation).toBe(1); // passes while stopped
  });

  it("a step during 'stopping' also aborts (blocked unless idle, one notch stricter than running alone)", async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    kernel.buffer.mutate(LoopState, () => ({ phase: 'stopping' as const }));

    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(GridState).generation).toBe(0); // the gate aborted
  });
});

describe('StatsState — stats emit for board transitions', () => {
  it('step emits the generation stats pipeline-produced (blinker: alive 3 / births 2 / deaths 2)', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(StatsState)).toEqual({ alive: 3, births: 2, deaths: 2 });
  });

  it('toggleCell emits as a transition too', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SimPort.toggleCell, { x: 0, y: 0 });
    expect(kernel.buffer.read(StatsState)).toEqual({ alive: 1, births: 1, deaths: 0 });
    await kernel.call(SimPort.toggleCell, { x: 0, y: 0 });
    expect(kernel.buffer.read(StatsState)).toEqual({ alive: 0, births: 0, deaths: 1 });
  });

  it('randomize emits as a transition from the previous board (alive = actual count)', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SimPort.randomize);
    const grid = kernel.buffer.read(GridState);
    const alive = grid.cells.reduce<number>((sum, cell) => sum + cell, 0);
    const stats = kernel.buffer.read(StatsState);
    expect(stats.alive).toBe(alive);
    expect(stats.births).toBe(alive); // a transition from an empty board, so births = alive
    expect(stats.deaths).toBe(0);
  });
});

describe('Circuit.Sim.stroke — stroke interpretation of normalized pointers', () => {
  /** Normalized coordinates pointing at the center of cell (x, y). */
  function centerOf(kernel: ReturnType<typeof makeTestKernel>, x: number, y: number) {
    const grid = kernel.buffer.read(GridState);
    return { u: (x + 0.5) / grid.width, v: (y + 0.5) / grid.height };
  }

  it('start→move→end toggles cells, and consecutive moves in the same cell are deduped', async () => {
    const kernel = makeTestKernel();
    const grid = kernel.buffer.read(GridState);

    await kernel.call(SimPort.strokeStart, centerOf(kernel, 1, 1));
    await kernel.call(SimPort.strokeMove, centerOf(kernel, 1, 1)); // same cell — suppressed
    await kernel.call(SimPort.strokeMove, centerOf(kernel, 2, 1)); // on to the neighbor
    await kernel.call(SimPort.strokeEnd);

    const cells = kernel.buffer.read(GridState).cells;
    expect(cells[1 * grid.width + 1]).toBe(1); // a double hit would have flipped it back to 0
    expect(cells[1 * grid.width + 2]).toBe(1);
  });

  it('moves outside a stroke are ignored (the sensor is expected to send everything)', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SimPort.strokeMove, centerOf(kernel, 3, 3)); // no start
    expect(kernel.buffer.read(GridState).cells.every((cell) => cell === 0)).toBe(true);

    await kernel.call(SimPort.strokeStart, centerOf(kernel, 3, 3));
    await kernel.call(SimPort.strokeEnd);
    await kernel.call(SimPort.strokeMove, centerOf(kernel, 4, 4)); // ignored after end too
    const grid = kernel.buffer.read(GridState);
    expect(grid.cells[3 * grid.width + 3]).toBe(1); // only the single hit from start
    expect(grid.cells[4 * grid.width + 4]).toBe(0);
  });

  it('points outside the board do not toggle', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SimPort.strokeStart, { u: 1.2, v: 0.5 });
    await kernel.call(SimPort.strokeEnd);
    expect(kernel.buffer.read(GridState).cells.every((cell) => cell === 0)).toBe(true);
  });
});

describe('Circuit.Settings.setGranularity — fork granularity', () => {
  it('setGranularity updates SimState and ignores unknown values', async () => {
    const kernel = makeTestKernel();
    expect(kernel.buffer.read(SimState).granularity).toBe('chunk');

    await kernel.call(SettingsPort.setGranularity, 'cell');
    expect(kernel.buffer.read(SimState).granularity).toBe('cell');

    await kernel.call(SettingsPort.setGranularity, 'bogus' as never);
    expect(kernel.buffer.read(SimState).granularity).toBe('cell'); // unchanged
  });

  it('4 glider generations produce the identical board at every granularity (chunk / row / cell)', async () => {
    // The degenerate form of "cell = pipeline" (cell granularity), and one row
    // per branch (row), must both converge to the same board as the chunk split
    // through the Emitter's order-preserving join.
    const boards = new Map<ForkGranularity, Uint8Array>();
    let width = 0;
    for (const granularity of ['chunk', 'row', 'cell'] as const) {
      const kernel = makeTestKernel();
      // Place a glider at (1,0),(2,1),(0,2),(1,2),(2,2)
      for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] as const) {
        await kernel.call(SimPort.toggleCell, { x, y });
      }
      await kernel.call(SettingsPort.setGranularity, granularity);
      for (let i = 0; i < 4; i++) await kernel.call(SimPort.step);

      const grid = kernel.buffer.read(GridState);
      expect(grid.generation).toBe(4);
      boards.set(granularity, grid.cells);
      width = grid.width;
    }

    expect(boards.get('row')).toEqual(boards.get('chunk'));
    expect(boards.get('cell')).toEqual(boards.get('chunk'));

    // Direct verification against the known solution: a glider moves (+1, +1) in 4 generations.
    const expected = new Set(
      [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]].map(([x, y]) => y * width + x),
    );
    const alive = new Set<number>();
    boards.get('chunk')!.forEach((cell, index) => {
      if (cell === 1) alive.add(index);
    });
    expect(alive).toEqual(expected);
  });

  it('the loop keeps spinning after a granularity switch while running (runtime-sized fork(symbol) fan-out)', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SettingsPort.setSpeed, 200); // 5ms/generation

    await kernel.call(SimPort.play);
    await sleep(80);
    const beforeSwitch = kernel.buffer.read(GridState).generation;
    expect(beforeSwitch).toBeGreaterThanOrEqual(2);

    await kernel.call(SettingsPort.setGranularity, 'row'); // the next lap's partitionRanges call fans out over row-sized ranges instead
    await sleep(80);
    const afterSwitch = kernel.buffer.read(GridState).generation;
    expect(afterSwitch).toBeGreaterThan(beforeSwitch); // generations keep advancing across the switch

    await kernel.call(SimPort.pause);
    await sleep(100);
  });
});

describe('Circuit.Sim.toggleCell / setSpeed / randomize', () => {
  it('toggleCell flips the cell and swaps the reference copy-on-write', async () => {
    const kernel = makeTestKernel();
    const before = kernel.buffer.read(GridState);

    await kernel.call(SimPort.toggleCell, { x: 3, y: 4 });
    const after = kernel.buffer.read(GridState);
    expect(after.cells).not.toBe(before.cells); // the reference changes (React change detection depends on it)
    expect(after.cells[4 * after.width + 3]).toBe(1);
    expect(before.cells[4 * before.width + 3]).toBe(0); // the old snapshot is immutable

    await kernel.call(SimPort.toggleCell, { x: 3, y: 4 });
    expect(kernel.buffer.read(GridState).cells[4 * after.width + 3]).toBe(0);
  });

  it('setSpeed updates genPerSec and clamps non-positive values', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SettingsPort.setSpeed, 30);
    expect(kernel.buffer.read(SimState).genPerSec).toBe(30);
    await kernel.call(SettingsPort.setSpeed, -5);
    expect(kernel.buffer.read(SimState).genPerSec).toBe(0.1);
  });

  it('randomize fills the board and resets generation to 0', async () => {
    const kernel = makeTestKernel();
    await placeBlinker(kernel);
    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(GridState).generation).toBe(1);

    await kernel.call(SimPort.randomize);
    const grid = kernel.buffer.read(GridState);
    expect(grid.generation).toBe(0);
    expect(grid.cells.length).toBe(grid.width * grid.height);
    const alive = grid.cells.reduce<number>((sum, cell) => sum + cell, 0);
    expect(alive).toBeGreaterThan(0); // density 0.3 — total extinction is practically impossible
    expect(alive).toBeLessThan(grid.cells.length);
  });
});

describe('no-op writes keep the current reference (the flip side of copy-on-write)', () => {
  /** Place a 2x2 block (still life) at (1,1)-(2,2). */
  async function placeBlock(kernel: ReturnType<typeof makeTestKernel>): Promise<void> {
    await kernel.call(SimPort.toggleCell, { x: 1, y: 1 });
    await kernel.call(SimPort.toggleCell, { x: 2, y: 1 });
    await kernel.call(SimPort.toggleCell, { x: 1, y: 2 });
    await kernel.call(SimPort.toggleCell, { x: 2, y: 2 });
  }

  it('a step over a still life keeps the StatsState reference (no fresh reference for equal values)', async () => {
    const kernel = makeTestKernel();
    await placeBlock(kernel);

    await kernel.call(SimPort.step);
    const stats = kernel.buffer.read(StatsState);
    expect(stats).toEqual({ alive: 4, births: 0, deaths: 0 });

    await kernel.call(SimPort.step);
    expect(kernel.buffer.read(StatsState)).toBe(stats); // equal value → the current reference stays
    expect(kernel.buffer.read(GridState).generation).toBe(2); // GridState really changes (generation), so it advances
  });

  it('a strokeEnd outside a stroke (double-sent via pointerLeave) keeps the StrokeState reference', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SimPort.strokeEnd); // arrives without a start (pointerLeave — the sensor sends everything)
    const stroke = kernel.buffer.read(StrokeState);
    await kernel.call(SimPort.strokeEnd);
    expect(kernel.buffer.read(StrokeState)).toBe(stroke);
  });

  it('same-value setSpeed / setGranularity keep the SimState reference', async () => {
    const kernel = makeTestKernel();
    await kernel.call(SettingsPort.setSpeed, 30);
    const sim = kernel.buffer.read(SimState);
    await kernel.call(SettingsPort.setSpeed, 30);
    expect(kernel.buffer.read(SimState)).toBe(sim);
    await kernel.call(SettingsPort.setGranularity, sim.granularity);
    expect(kernel.buffer.read(SimState)).toBe(sim);
  });
});

describe('Circuit.Faults.clearError', () => {
  it('clears a seeded KernelErrorState message back to null', async () => {
    const kernel = makeTestKernel();
    kernel.buffer.mutate(KernelErrorState, () => ({ message: 'boom' }));
    expect(kernel.buffer.read(KernelErrorState).message).toBe('boom');

    await kernel.call(FaultsPort.clearError);

    expect(kernel.buffer.read(KernelErrorState).message).toBeNull();
  });

  it('already null: the read reference is unchanged (no-op copy-on-write)', async () => {
    const kernel = makeTestKernel();
    const before = kernel.buffer.read(KernelErrorState);
    expect(before.message).toBeNull();

    await kernel.call(FaultsPort.clearError);

    expect(kernel.buffer.read(KernelErrorState)).toBe(before);
  });

  it('does not touch WiringDefectState', async () => {
    const kernel = makeTestKernel();
    kernel.buffer.mutate(KernelErrorState, () => ({ message: 'boom' }));
    const defectBefore = kernel.buffer.read(WiringDefectState);

    await kernel.call(FaultsPort.clearError);

    expect(kernel.buffer.read(WiringDefectState)).toBe(defectBefore);
  });
});
