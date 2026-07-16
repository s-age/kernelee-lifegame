// circuit/sim/launchArm.gate.ts — Gate part (framework interceptor/gate, not a Switch).
//
// The decision: was the loop idle (→ arm a FRESH launch: proceed to play's
// `.spawn`) or already active (stopping/running → recover the phase to
// 'running' and reuse the in-flight loop, no relaunch). Named after the
// decision — the double-start guard — not the destination. It is the
// framework-level pre-handler veto form of what `launchTickLoop`'s guard used
// to do inline, and what a `*.switch.ts` entry stage did before the
// interceptor/gate primitive existed (migration of pre-handler vetoes to
// `declareGate`/`KernelBuilder.guard`).
//
// **No longer a part file.** A Switch translates a decision already sitting
// on the pipe's own cursor/state into a verb *inside* a pipe; this gate runs
// BEFORE `Circuit.Sim.play`'s handler is even invoked (see driver/wiring.ts's
// `bindGuards`), so it has no stage-link chain and no pipe-stage
// `StageEntry.handler.site` — it is invisible to `*.switch.ts`'s topology
// contract. The `.gate.ts` suffix is deliberate and non-part:
// `tests/introspectIndex.test.ts` no longer counts this file among the
// switches (9 → 5 after this migration).
//
// **Declared exception (writesState outside a Mutator):** the LoopState write
// (→ 'running') is inseparable from the decision — `wasIdle` must be read and
// the phase applied atomically (no await between) or a re-entrant `play` could
// double-launch the loop. Same "transition inseparable from the decision"
// exception as runningPhase.switch.ts; the write is named in
// tests/introspectIndex.test.ts's WRITES_STATE_MUTATOR_ALLOWLIST (now under
// this gate's own site, surfaced via `IndexDocument.gates[].writesState`
// phased `'gate'` — not silently dropped just because it left the stage tree).
//
// `abort(undefined)` here is the approved O=void bus-entry ignore contract
// (owner decision): `Circuit.Sim.play` is a `portK<void, void>` command, so a
// veto silently declining to relaunch is exactly the ignore semantics the
// endpoint's own description promises. `abort` from a gate always terminates
// the ENCLOSING flow (here: the whole `Circuit.Sim.play` call) — safe only
// because `play` is never composed mid-pipe by another saga; re-evaluate if
// that ever changes (see `.claude/rules/arch-circuit.md`'s Gate section).
//
// Passed as a bare identifier to `declareGate('guard:loop.launchArm', launchArmGate)`
// (a named handler with an address in the index's GateEntry.handler).

import { abort, declareGate, next, type Kernel, type Verb } from '@s-age/kernelee';
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

/** Guards `Circuit.Sim.play` — bound in driver/wiring.ts's `bindGuards`. */
export const launchArmGateRef = declareGate<void>('guard:loop.launchArm', launchArmGate);
