// circuit/sim/cellVisit.switch.ts — Switch part.
//
// The principle for a Switch is "only translate the device's decision into a
// verb (next/abort/divert)" (named after the **decision**, not the destination —
// this decision is the cell's visibility (outside the board?) and identity with
// the most recently visited cell). This gate, however, is an exception: the
// diverting branch carries a write to StrokeState.last (updating the most
// recently visited cell) inseparably from the decision — deciding "which cell
// to toggle next" and "updating the last cell" can only be done atomically
// inside the same single check (splitting the update into a later stage would
// lose the basis for rejecting rapid repeats on the same cell in between).
// "Selects only" is a discipline, not a definition; only transitions
// inseparable from the decision may cohabit here.
//
// Passed as a bare identifier to `.pipe(meta, cellVisitGate)` (as a named
// handler it has an address in the index's StageEntry.handler).

import { abort, divert, diversion, type Kernel } from '@s-age/kernelee';
import type { CellCoord } from '../../contract/ports';
import { StrokeState } from '../../contract/states';
import { togglePipe } from './toggleCell';

/**
 * Gate on outside-the-board / same-cell repeats → update stroke state → on to
 * the toggle. The final verb of the appendStrokeVisit shared stage sequence
 * (applies to both strokeStart and strokeMove).
 */
export function cellVisitGate(kernel: Kernel, cell: CellCoord | null) {
  if (!cell) return abort(undefined); // outside the board
  const last = kernel.buffer.read(StrokeState).last;
  if (last && last.x === cell.x && last.y === cell.y) return abort(undefined); // suppress same-cell repeats
  kernel.buffer.mutate(StrokeState, (stroke) => ({ ...stroke, last: cell }));
  return divert(diversion(togglePipe, cell));
}
