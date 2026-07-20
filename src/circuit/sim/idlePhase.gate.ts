// circuit/sim/idlePhase.gate.ts — Gate part (framework interceptor/gate, not a Switch).
//
// The decision is LoopState.phase; it holds no writes: a pure selects-only
// gate (no exception needed). Migrated from a pipe-entry Switch to a
// framework `declareGate`/`KernelBuilder.guard` pre-handler veto — this gate
// now runs BEFORE `Circuit.Sim.step`'s one stage (the
// `Circuit.Sim.advanceGeneration` symbol-composition edge, step.ts) is even
// reached, which is intentional and strictly cheaper: the veto no longer
// pays for a stage it is going to discard.
//
// **No longer a part file** — invisible to `*.switch.ts`'s stage-link
// topology (see launchArm.gate.ts's own doc comment for the general
// reasoning). `.gate.ts` is deliberate and non-part.
//
// `abort(undefined)` here is the approved O=void bus-entry ignore contract:
// `Circuit.Sim.step` is a `portK<void, void>` command. `abort` from a gate
// always terminates the ENCLOSING flow; safe only because `step` is never
// composed mid-pipe by another saga.
//
// Passed as a bare identifier to `declareGate('guard:loop.idle', idlePhaseGate)`
// (a named handler with an address in the index's GateEntry.handler).

import { abort, declareGate, next, type Kernel } from '@s-age/kernelee';
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
  return kernel.buffer.read(LoopState).phase !== 'idle' ? abort(undefined, 'not idle — step ignored') : next();
}

/** Guards `Circuit.Sim.step` — bound in driver/wiring.ts's `bindGuards`. */
export const idlePhaseGateRef = declareGate<void>('guard:loop.idle', idlePhaseGate);
