// circuit/sim/tickLoop.bridge.ts — Bridge part (the first `*.bridge.ts` in this app).
//
// A Bridge names a decisionless connector: no state read, no cursor
// inspection, just one fixed hop taken. This file names the hop into the
// generation loop body (Circuit.Sim.tickLoop) — reused at its two call
// sites: play's detached `.spawn` launcher (the loop's very first lap) and
// the loop's own lap-end (the self-divert reentry that keeps it running).
// Both hops target the exact same typed key (SimFlowKeys.tickLoop), so one
// function serves both — a Bridge's definition does not REQUIRE reuse, it
// just does not hinge on it either.
//
// Until this card this hop was `granularitySwitch` (circuit/sim/
// granularity.switch.ts, now deleted): it read SimState.granularity +
// GridState's board size to pick one of three pre-built per-(granularity,
// size) loop variants. Since `fork(LifePort.stepIndexRange)` now fans a
// Compute-computed, runtime-sized range list out over a SINGLE tickLoopPipe
// module constant (advanceGeneration.ts), there is only one destination left
// — the read is gone, and what remains is a bare hop: a Bridge, not a Switch.
//
// Passed as a bare identifier to `.pipe(meta, tickLoopBridge)` (as a named
// handler it has an address in the index's StageEntry.handler).

import type { DivertChannel, Kernel } from '@s-age/kernelee';
import { SimFlowKeys } from '../../contract/ports';

/**
 * The typed divert channel this bridge receives as its third argument — see
 * cellVisit.switch.ts's `CellVisitDiverts` for the same shape's own doc
 * comment. `_cursor` is untyped (`unknown`): the two call sites carry
 * different cursor types (tickLoop's own end carries `GenerationResult`,
 * play's launcher carries `void`), and this bridge inspects neither — it
 * only takes the one fixed hop.
 */
export type TickLoopDiverts = DivertChannel<{ tickLoop: typeof SimFlowKeys.tickLoop }>;

/** Unconditional hop into the generation loop body — no decision, no state read. */
export function tickLoopBridge(_kernel: Kernel, _cursor: unknown, diverts: TickLoopDiverts) {
  return diverts.tickLoop(undefined);
}
