// circuit/sim/toggleCell.ts — cell-flip saga (whatever writes GridState emits StatsState as a pair).
// Note: this is not a Switch: it is transition handling with an effect (buffer
// mutate + stats emit), so it is a verbNoun-named saga.
//
// **Declared CI-floor exception**: the GridState write in the first stage (the
// `kernel.buffer.mutate(GridState, ...)` below) is performed atomically inside
// the same mutate callback that computes the toggle target index — inseparable.
// The `grid` the mutate callback receives is the buffer's very latest value at
// that instant, so computing the index outside the callback (a `buffer.read` in
// a separate stage) would open a read→write race window against the tick
// loop's concurrent writes and could roll the board back. "Keeping the
// computation + write inside the same mutate call" is itself the correctness
// condition, so this write is not extracted to `*.mutator.ts` (the same
// "transition inseparable from the decision/computation" case as
// runningPhase.switch.ts / cellVisit.switch.ts — but as a plain verb stage
// rather than a Switch, it is listed in the allowlist by file name).
// The trailing StatsState emit (merely writing the diffStats result) is not
// inseparable, so it is extracted to toggleCell.mutator.ts.

import { next, pipeline, type Kernel } from '@s-age/kernelee';
import { LifePort, type CellCoord } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { applyToggleStats } from './toggleCell.mutator';

/**
 * A pipe that toggles a single cell and emits the transition stats. The
 * GridState swap happens atomically inside the mutate callback (never roll the
 * board back by racing the tick loop), the settled prev/next pair becomes the
 * cursor, and the stats are aggregated by Compute at the `.pipe(diffStats)`
 * stage. Also the divert target of the stroke saga (paired with
 * strokeVisitPipe's divertsTo declaration).
 */
export const togglePipe = pipeline(
  { note: 'Toggle write (copy-on-write atomically inside mutate) → assemble the transition pair' },
  (kernel: Kernel, { x, y }: CellCoord) => {
    let prev!: Uint8Array;
    let nextCells!: Uint8Array;
    kernel.buffer.mutate(GridState, (grid) => {
      prev = grid.cells;
      nextCells = new Uint8Array(grid.cells); // copy-on-write
      const index = y * grid.width + x;
      nextCells[index] = nextCells[index] === 1 ? 0 : 1;
      return { ...grid, cells: nextCells };
    });
    return next({ prev, next: nextCells });
  },
)
  .pipe(LifePort.diffStats)
  .effect(applyToggleStats) // Mutator part (toggleCell.mutator.ts): buffer write only
  .seal();

export function applyToggle(kernel: Kernel, cell: CellCoord): Promise<void> {
  return kernel.run(togglePipe, cell);
}
