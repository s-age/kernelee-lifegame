// circuit/sim/running.mutator.ts — Mutator part for LoopState.phase.
//
// Mutator: a part holding only pure buffer transitions that **call no symbols**
// (plus an optional fire-and-forget launch). Making these pipes would add no
// symbol edges and put no information on the wiring graph, so they deliberately
// stay plain handlers (the dividing line with sagas: calls a symbol → pipe,
// does not → Mutator).
//
// launchTickLoop belongs here because the idle→running transition itself is
// inseparable from the launch decision (launch fresh, or merely recover from
// 'stopping'?) — exactly the Mutator definition of "buffer transition +
// fire-and-forget launch"; there is no reason for it to share a file with
// tickLoopPipeFor (symbol-calling pipe assembly).

import { KernelErrorState, type Kernel } from '@s-age/kernelee';
import { GridState, LoopState, SimState } from '../../contract/states';
import { tickLoopPipeFor } from './tickLoop';

/** When not running (idle), launch the tick loop (self-divert) fire-and-forget
 * (with a double-start guard). When running or stopping, merely flip that loop
 * back to 'running' (no relaunch). */
export function play(kernel: Kernel): void {
  launchTickLoop(kernel);
}

/** Set 'stopping' only while 'running' — the next lap's gate aborts, drops to
 * idle, and the loop stops naturally. Already 'idle'/'stopping': do nothing. */
export function pause(kernel: Kernel): void {
  kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'running' ? { phase: 'stopping' as const } : loop));
}

/**
 * Launch rule: never put the loop on dispatch (the serial CommandBus) — the
 * bus would be blocked forever.
 * Only when phase is 'idle' does `kernel.run` actually launch as a
 * fire-and-forget task. When called from 'stopping', the existing loop is
 * merely flipped back to 'running' and reused (no double start). Errors go to
 * KernelErrorState. The phase write and the launch decision are inseparable
 * (safe because the read→mutate runs synchronously with no await in between).
 */
export function launchTickLoop(kernel: Kernel): void {
  const wasIdle = kernel.buffer.read(LoopState).phase === 'idle';
  // Keep the current reference when already 'running' (a re-entrant play while running must not produce a no-op fresh reference).
  kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'running' ? loop : { phase: 'running' as const }));
  if (!wasIdle) return; // double-start guard (pause→play re-entry; from stopping we only recover)
  const grid = kernel.buffer.read(GridState);
  const { granularity } = kernel.buffer.read(SimState);
  void kernel.run(tickLoopPipeFor(granularity, grid.width, grid.height)).catch((error: unknown) => {
    kernel.buffer.mutate(LoopState, () => ({ phase: 'idle' as const }));
    const message = error instanceof Error ? error.message : String(error);
    kernel.buffer.mutate(KernelErrorState, () => ({ message: `Circuit.Sim.tickLoop: ${message}` }));
  });
}
