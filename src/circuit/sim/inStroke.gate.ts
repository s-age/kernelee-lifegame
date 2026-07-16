// circuit/sim/inStroke.gate.ts — Gate part (framework interceptor/gate, not a Switch).
//
// The decision is StrokeState.active; it holds no writes: a pure selects-only
// gate (no exception needed). Migrated from a pipe-entry Switch to a
// framework `declareGate`/`KernelBuilder.guard` pre-handler veto, guarding
// `Circuit.Sim.strokeMove`.
//
// **No longer a part file** — invisible to `*.switch.ts`'s stage-link
// topology (see launchArm.gate.ts's own doc comment for the general
// reasoning). `.gate.ts` is deliberate and non-part.
//
// `next()` — not `next(point)` — even though the payload is a
// `NormalizedPoint`: `declareGate`'s own doc comment states a gate's `next(v)`
// value is DISCARDED in v1 (the guarded handler always sees the call's
// *original* payload), so passing the point along here would silently lie
// about what happens; `next()` says exactly what runs.
//
// `abort(undefined)` here is the approved O=void bus-entry ignore contract:
// `Circuit.Sim.strokeMove` is a `portK<NormalizedPoint, void>` command whose
// own description already promises "ignored unless a stroke is active".
// `abort` from a gate always terminates the ENCLOSING flow; safe only because
// `strokeMove` is never composed mid-pipe by another saga.
//
// Passed as a bare identifier to `declareGate('guard:stroke.active', inStrokeGate)`
// (a named handler with an address in the index's GateEntry.handler).

import { abort, declareGate, next, type Kernel } from '@s-age/kernelee';
import type { NormalizedPoint } from '../../contract/ports';
import { StrokeState } from '../../contract/states';

/** Outside-a-stroke gate (a move without a start aborts). */
export function inStrokeGate(kernel: Kernel, _point: NormalizedPoint) {
  return kernel.buffer.read(StrokeState).active ? next() : abort(undefined);
}

/** Guards `Circuit.Sim.strokeMove` — bound in driver/wiring.ts's `bindGuards`. */
export const inStrokeGateRef = declareGate<NormalizedPoint>('guard:stroke.active', inStrokeGate);
