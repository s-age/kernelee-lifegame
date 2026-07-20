// circuit/sim/cellVisit.switch.ts — Switch part.
//
// The principle for a Switch is "only translate the device's decision into a
// verb (next/abort/divert)" (named after the **decision**, not the destination —
// this decision is the cell's visibility (outside the board?) and identity with
// the most recently visited cell). This Switch, however, is an exception: the
// diverting branch carries a write to StrokeState.last (updating the most
// recently visited cell) inseparably from the decision — deciding "which cell
// to toggle next" and "updating the last cell" can only be done atomically
// inside the same single check (splitting the update into a later stage would
// lose the basis for rejecting rapid repeats on the same cell in between).
// "Selects only" is a discipline, not a definition; only transitions
// inseparable from the decision may cohabit here.
//
// Passed as a bare identifier to `.pipe(meta, cellVisitSwitch)` (as a named
// handler it has an address in the index's StageEntry.handler).

import { abort, type DivertChannel, type Kernel } from '@s-age/kernelee';
import { type CellCoord, type SimFlowKeys } from '../../contract/ports';
import { StrokeState } from '../../contract/states';

/**
 * The typed divert channel this switch receives as its third argument — built by
 * kernelee from the calling stage's own `divertsTo: { toggle:
 * SimFlowKeys.toggleCell }` declaration (circuit/sim/stroke.ts). Deriving the
 * shape from the minted key (`typeof SimFlowKeys.toggleCell`) keeps the
 * payload type single-sourced: the key pins `CellCoord` here, at the
 * declaration site, and at the `builder.flow(...)` binding (driver/wiring.ts)
 * alike.
 */
type CellVisitDiverts = DivertChannel<{ toggle: typeof SimFlowKeys.toggleCell }>;

/**
 * Switch on outside-the-board / same-cell repeats → update stroke state → on
 * to the toggle. The final verb of `strokeMovePipe` (stroke.ts) — the shared
 * visit-interpretation pipe both stroke entries reach (strokeMove by
 * dispatch, strokeStart by divert through strokeMove.bridge.ts).
 *
 * The toggle hop rides the typed divert tier: `diverts.toggle(cell)` builds a
 * key-form diversion (`{ key: 'Circuit.Sim.toggleCell', payload: cell }`) the
 * kernel resolves against its flow table at the moment the verb is
 * interpreted — this file no longer imports togglePipe at all (the coupling
 * moved from a value import to a bound key, same as symbol dispatch), and tsc
 * pins `cell` to the key's `CellCoord` payload type.
 */
export function cellVisitSwitch(kernel: Kernel, cell: CellCoord | null, diverts: CellVisitDiverts) {
  if (!cell) return abort(undefined, 'outside the board');
  const last = kernel.buffer.read(StrokeState).last;
  if (last && last.x === cell.x && last.y === cell.y) return abort(undefined, 'suppress same-cell repeats');
  kernel.buffer.mutate(StrokeState, (stroke) => ({ ...stroke, last: cell }));
  return diverts.toggle(cell);
}
