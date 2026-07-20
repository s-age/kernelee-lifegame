// circuit/sim/runningPhase.switch.ts — Switch part.
//
// The principle for a Switch is "only translate the device's decision into a
// verb (next/abort/divert/fail)" (named after the **decision**, not the
// destination — this decision is LoopState.phase). This Switch, however, is an
// exception: the aborting branch carries a write to LoopState (settling on
// idle) inseparably from the decision. No stage follows (the abort cuts the
// run short), so there is nowhere to extract that write to — "selects only" is
// a discipline, not a definition; only transitions inseparable from the
// decision may cohabit here.
//
// Passed as a bare identifier to `pipeline(meta, runningPhaseSwitch)` (as a named
// handler it has an address in the index's StageEntry.handler).

import { abort, next, type Kernel } from '@s-age/kernelee';
import { LoopState } from '../../contract/states';

/**
 * Phase switch (abort unless running = natural stop, settling the phase on idle).
 */
export function runningPhaseSwitch(kernel: Kernel, _payload: void) {
  if (kernel.buffer.read(LoopState).phase !== 'running') {
    // Stop settled — lower the phase so the next play can relaunch. Keep the current reference when already 'idle'.
    kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'idle' ? loop : { phase: 'idle' as const }));
    return abort(undefined, 'stop settled — phase lowered to idle');
  }
  return next();
}
