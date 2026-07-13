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

/**
 * Fault cleanup for the detached tick-loop task: settle the phase back to
 * 'idle' (so the next play can relaunch) and surface the fault on the
 * framework's KernelErrorState channel. A pure buffer-transition Mutator
 * (calls no symbols) — the named, discoverable home for what used to be an
 * anonymous cleanup body inside `launchTickLoop`'s `.catch`.
 *
 * The idle settle uses the reference-preserving `idle-if-not-idle` form, the
 * same canonical LoopState "stop settled" transition runningPhase.switch.ts's
 * gate applies when the loop stops naturally — the fault path and the normal
 * stop path now agree on the shape of "lower the phase to idle". They are
 * deliberately NOT hoisted into one shared helper: the gate's write is a
 * Switch's decision-inseparable exception (runningPhase.switch.ts's own doc),
 * this one is a Mutator's buffer transition — two different part kinds, and
 * coupling them across that boundary would buy nothing the one-line
 * expression doesn't already state.
 *
 * ARCHITECTURAL RESIDUE (followup, not this card): the KernelErrorState write
 * here manually reproduces what kernelee's default error sink already does for
 * a failed `dispatch` (`#defaultErrorSink`, `"symbolId: message"`) — it exists
 * only because `kernel.run(pipe)` has no error-sink channel of its own for a
 * fire-and-forget launch. A kernelee `run(pipe, { onError })` API would let
 * this write move into the framework; until then it is an honest app-side
 * residue, kept here rather than swallowed.
 */
export function settleTickLoopFault(kernel: Kernel, error: unknown): void {
  kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'idle' ? loop : { phase: 'idle' as const }));
  const message = error instanceof Error ? error.message : String(error);
  kernel.buffer.mutate(KernelErrorState, () => ({ message: `Circuit.Sim.tickLoop: ${message}` }));
}

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
  // Fire-and-forget (a detached loop must never go on the serial CommandBus).
  // The `.catch` is the minimal safety net an unexpected thrown exception in a
  // detached task has nowhere else to land — its body is now the named
  // Mutator `settleTickLoopFault` (LoopState→idle + KernelErrorState).
  void kernel.run(tickLoopPipeFor(granularity, grid.width, grid.height)).catch((error: unknown) =>
    settleTickLoopFault(kernel, error),
  );
}
