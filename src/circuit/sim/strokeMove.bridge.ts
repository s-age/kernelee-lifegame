// circuit/sim/strokeMove.bridge.ts — Bridge part.
//
// A decisionless connector: strokeStart's hop into the shared
// visit-interpretation pipe (Circuit.Sim.strokeMove). strokeStart's meaning
// is "arm the stroke state, then have the start point interpreted as the
// first move" — so once the state is armed, the one fixed destination is
// strokeMovePipe itself, and the hop carries no decision: a Bridge, not a
// Switch. Until this change the two pipes shared the visit sequence through
// the `appendStrokeVisit` entry-builder appender (now deleted): the shared
// TAIL is expressed as pipeline-value composition instead — one flow-bound
// pipe, entered by divert (owner-decided 2026-07-19).
//
// Unlike tickLoopBridge (payload `void`), this bridge CARRIES
// its cursor (the `NormalizedPoint` being interpreted) — forwarding the
// cursor untouched as the diversion's payload is not cursor *inspection*, so
// it stays within the Bridge definition (no decision, no state read).
//
// The divert resolves against the kernel's flow table
// (`builder.flow(SimFlowKeys.strokeMove, …)` in driver/wiring.ts), reaching
// strokeMovePipe DIRECTLY — `guard:stroke.active` (the gate on the
// `Circuit.Sim.strokeMove` bus entry) does not run on this path. That is by
// design: strokeStart's own entry stage (`armStrokeState`) has just armed the
// state, so the gate's verdict would be allow anyway.
//
// Passed as a bare identifier to `.pipe(meta, strokeMoveBridge)` (as a named
// handler it has an address in the index's StageEntry.handler).

import type { DivertChannel, Kernel } from '@s-age/kernelee';
import { SimFlowKeys, type NormalizedPoint } from '../../contract/ports';

/** The typed divert channel this bridge receives as its third argument. */
export type StrokeMoveDiverts = DivertChannel<{ strokeMove: typeof SimFlowKeys.strokeMove }>;

/** Unconditional hop into the shared visit interpretation — no decision, no state read; the point rides along. */
export function strokeMoveBridge(_kernel: Kernel, point: NormalizedPoint, diverts: StrokeMoveDiverts) {
  return diverts.strokeMove(point);
}
