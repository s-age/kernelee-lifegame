// circuit/sim/launchArm.switch.ts — Switch part.
//
// The decision: was the loop idle (→ arm a FRESH launch: proceed to play's
// `.spawn`) or already active (stopping/running → recover the phase to
// 'running' and reuse the in-flight loop, no relaunch). Named after the
// decision — the double-start guard — not the destination. It is the pipe
// entry-gate form of what `launchTickLoop`'s guard used to do inline.
//
// **Declared exception (writesState outside a Mutator):** the LoopState write
// (→ 'running') is inseparable from the decision — `wasIdle` must be read and
// the phase applied atomically (no await between) or a re-entrant `play` could
// double-launch the loop. Same "transition inseparable from the decision"
// exception as runningPhase.switch.ts; the write is named in
// tests/introspectIndex.test.ts's WRITES_STATE_MUTATOR_ALLOWLIST.
//
// Passed as a bare identifier to `pipeline(meta, launchArmGate)` (a named
// handler with an address in the index's StageEntry.handler).

import { abort, next, type Kernel, type Verb } from '@s-age/kernelee';
import { LoopState } from '../../contract/states';

/**
 * Arm the loop phase and decide whether `play` launches a fresh loop.
 * `next()` — was idle, arm running and proceed to the `.spawn` launch.
 * `abort()` — was stopping/running, phase recovered to 'running', no relaunch.
 */
export function launchArmGate(kernel: Kernel, _payload: void): Verb<void> {
  const wasIdle = kernel.buffer.read(LoopState).phase === 'idle';
  // Keep the current reference when already 'running' (a re-entrant play while
  // running must not produce a no-op fresh reference).
  kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'running' ? loop : { phase: 'running' as const }));
  // Only a fresh launch from idle proceeds to the `.spawn`; from 'stopping' we
  // merely recovered the phase to 'running' and reuse the in-flight loop.
  return wasIdle ? next() : abort(undefined);
}
