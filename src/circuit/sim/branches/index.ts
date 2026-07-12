// circuit/sim/branches — fork branch construction (granularity is a "value" —
// only the list of index ranges changes; there is a single way to build a
// branch (one builder)).
//
// **fork**: fans the board out into N branches according to granularity
// (chunk=CHUNK_COUNT / row=height / cell=width*height), collects them in order,
// and joins them into one board with the Emitter (.map, aggregation only).
// 'cell' is the degenerate form of "cell = pipeline", a granularity for feeling
// the granularity-vs-overhead trade-off.
// Note: JS is single-threaded, so fork is cooperative concurrency (a demo of
// the API shape), not real CPU parallelism (see README).
//
// The three granularities differ only in how the ranges are carved — the range
// computation is unified into a single Compute symbol (stepIndexRange), so a
// fork branch always has the one shape "1 builder (rangeBranch) × N (ranges)";
// changing the granularity never changes the structure.
//
// **The table itself must stay** (BRANCH_FAMILIES). Folding it into a `switch`
// statement makes the `valueSelectors` (the granularity value set), the
// `branchSelector` correlation edge (fork↔selector), and the branches' `flows`
// vanish from the index simultaneously — a silent hole that does not even show
// up as unresolved. "Unifying into one builder" and "dropping the table" are
// separate changes.

import { next, pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { LifePort } from '../../../contract/ports';
import { CHUNK_COUNT, type ForkGranularity, type Grid } from '../../../contract/states';

/** Half-open range `[start, end)` of row-major flat indices. */
export interface StepRange {
  readonly start: number;
  readonly end: number;
}

/** Result of a fork branch — a Uint8Array of the range, common to all granularities. */
export type BranchResult = Uint8Array;

/** Branch pipe responsible for `range` — the single builder shared by all granularities. */
function rangeBranch(range: StepRange): Pipe<Grid, Uint8Array> {
  return pipeline({ note: `Distribute the board to index range [${range.start}, ${range.end})` }, (_kernel: Kernel, grid: Grid) =>
    next(grid),
  )
    .map({ note: 'Assemble the stepIndexRange payload (board + assigned index range)' }, (grid) => ({
      cells: grid.cells,
      width: grid.width,
      height: grid.height,
      start: range.start,
      end: range.end,
    }))
    .pipe(LifePort.stepIndexRange)
    .seal();
}

/**
 * Granularity → branch list (ranges of row-major flat indices, `[start, end)`).
 * chunk = CHUNK_COUNT branches (ranges aligned to row boundaries) / row = height
 * branches (one row each) / cell = width*height branches (one cell each).
 * **All three cases use the single builder `rangeBranch`** — only the carving of
 * the ranges changes; the branch structure does not.
 *
 * This is a `Record<ForkGranularity, ...>` literal rather than a `switch`
 * statement for kernel-introspect control-structure tokenization: only this
 * shape (a module-scope table + a function that directly returns
 * `TABLE[param](...)`) gets indexed as `valueSelectors`, gets the fork's
 * `branchSelector` correlation edge, and has the branch chains' `flows`
 * recovered from each case's `Array.from(…, (_, i) => BUILDER(i))`. **Reverting
 * to a switch silently drops all three** (`valueSelectors` becomes an empty
 * array and nothing shows up as unresolved).
 */
const BRANCH_FAMILIES: Readonly<
  Record<ForkGranularity, (width: number, height: number) => ReadonlyArray<Pipe<Grid, BranchResult>>>
> = {
  chunk: (width, height) =>
    Array.from({ length: CHUNK_COUNT }, (_, index) =>
      rangeBranch({
        start: Math.floor((height * index) / CHUNK_COUNT) * width,
        end: Math.floor((height * (index + 1)) / CHUNK_COUNT) * width,
      }),
    ),
  row: (width, height) =>
    Array.from({ length: height }, (_, y) => rangeBranch({ start: y * width, end: (y + 1) * width })),
  cell: (width, height) =>
    Array.from({ length: width * height }, (_, index) => rangeBranch({ start: index, end: index + 1 })),
};

/** Branch list for the given granularity. Row order (cell is row-major too) = the Emitter's join order. */
export function branchesFor(
  granularity: ForkGranularity,
  width: number,
  height: number,
): ReadonlyArray<Pipe<Grid, BranchResult>> {
  return BRANCH_FAMILIES[granularity](width, height);
}
