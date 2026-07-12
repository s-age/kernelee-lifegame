// circuit/sim/idlePhase.switch.ts — Switch part.
//
// A Switch "only translates the device's decision into a verb (next/abort)" —
// this decision is LoopState.phase. It holds no writes: a pure selects-only
// Switch (no exception needed).
//
// Passed as a bare identifier to `pipeline(meta, idlePhaseGate)` (as a named
// handler it has an address in the index's StageEntry.handler).

import { abort, next, type Kernel } from '@s-age/kernelee';
import { LoopState } from '../../contract/states';

/**
 * Entry gate (abort unless idle).
 *
 * The invariant "never step while running (whether running or stopping)" is
 * owned by circuit. Blocking 'stopping' as well closes the window in which a
 * step could race with the tail generation of a loop that has not yet noticed
 * the pause (the tick loop is launched directly via kernel.run, not through the
 * dispatch bus). The UI's disabled control is decoration (rendering of state),
 * not a load-bearing guard.
 */
export function idlePhaseGate(kernel: Kernel, _payload: void) {
  return kernel.buffer.read(LoopState).phase !== 'idle' ? abort(undefined) : next();
}
