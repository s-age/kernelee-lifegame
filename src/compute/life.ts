// compute/life.ts — pure logic (kernel-independent, no I/O).
// Ring rule: compute depends only on contract.

import type {
  DiffStatsInput,
  CellCoord,
  HitCellInput,
  PartitionInput,
  RandomizeInput,
  StepIndexRangeInput,
} from '../contract/ports';
import { CHUNK_COUNT, type Stats } from '../contract/states';

/**
 * Advance only the cells at row-major flat indices `start` (inclusive) to `end`
 * (exclusive) one generation under B3/S23 with torus boundaries (edges wrap).
 * `cells` is a read-only reference to the whole board (never mutated). The
 * return value is a new Uint8Array covering just that range (length = end - start).
 *
 * The outer while is the general form that also handles ranges starting and
 * ending mid-row, but the inner for never runs past one row: when `start`/`end`
 * are aligned to row boundaries (chunk/row granularity) the outer loop runs
 * exactly once per row, and up/mid/down are computed only once per row (cache
 * locality and work per row stay optimal). When the range is one cell wide
 * (cell granularity) the outer loop runs exactly once.
 */
export function stepIndexRange({ cells, width, height, start, end }: StepIndexRangeInput): Uint8Array {
  const out = new Uint8Array(Math.max(0, end - start));
  let i = start;
  while (i < end) {
    const y = Math.floor(i / width);
    const rowStart = y * width;
    const rowEnd = Math.min(end, rowStart + width);
    const up = ((y - 1 + height) % height) * width;
    const mid = rowStart;
    const down = ((y + 1) % height) * width;
    for (; i < rowEnd; i++) {
      const x = i - rowStart;
      const left = (x - 1 + width) % width;
      const right = (x + 1) % width;
      const neighbours =
        cells[up + left] + cells[up + x] + cells[up + right] +
        cells[mid + left] + cells[mid + right] +
        cells[down + left] + cells[down + x] + cells[down + right];
      // B3/S23: a dead cell is born with 3 neighbours; a live cell survives with 2 or 3.
      out[i - start] = neighbours === 3 || (cells[mid + x] === 1 && neighbours === 2) ? 1 : 0;
    }
  }
  return out;
}

/** Half-open row-major flat index range `[start, end)`, in join order. */
interface IndexRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Granularity → the list of ranges that partitions a w×h board (row-major
 * flat indices). chunk = CHUNK_COUNT ranges aligned to row boundaries / row =
 * one range per row / cell = one range per cell (the degenerate form of
 * "cell = pipeline"). The value→count mapping is Compute-internal (the
 * doctrine of intentional non-symbolization for Compute internals — only the
 * Return DTO `partitionRanges` produces is contract-visible).
 */
function rowMajorRanges(width: number, height: number, granularity: PartitionInput['granularity']): readonly IndexRange[] {
  switch (granularity) {
    case 'chunk':
      return Array.from({ length: CHUNK_COUNT }, (_, index) => ({
        start: Math.floor((height * index) / CHUNK_COUNT) * width,
        end: Math.floor((height * (index + 1)) / CHUNK_COUNT) * width,
      }));
    case 'row':
      return Array.from({ length: height }, (_, y) => ({ start: y * width, end: (y + 1) * width }));
    case 'cell':
      return Array.from({ length: width * height }, (_, index) => ({ start: index, end: index + 1 }));
  }
}

/**
 * Partition a w×h board (w,h ≥ 1) into ≥1 complete `StepIndexRangeInput`
 * payloads whose ranges are non-overlapping, row-major-ordered, and jointly
 * cover the whole board — the payload shape `fork(LifePort.stepIndexRange)`
 * fans out over, one call per element. `cells` is the same reference shared
 * by every returned payload (never copied — `stepIndexRange` itself never
 * mutates its input).
 */
export function partitionRanges({ cells, width, height, granularity }: PartitionInput): ReadonlyArray<StepIndexRangeInput> {
  return rowMajorRanges(width, height, granularity).map(({ start, end }) => ({ cells, width, height, start, end }));
}

/**
 * Resolve normalized pointer coordinates (u, v) to a cell coordinate (null when
 * outside the board). The output is in cell space, so this is Compute work —
 * pixel→normalized is presentation's job (rect measurement = DOM); that is the
 * coordinate-system dividing line.
 */
export function hitCell({ u, v, width, height }: HitCellInput): CellCoord | null {
  const x = Math.floor(u * width);
  const y = Math.floor(v * height);
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  return { x, y };
}

/**
 * Statistics for the board transition prev → next. births/deaths are transition
 * quantities computable only from the before/after pair (alive is derivable from
 * next alone, but is returned together as part of the transition stats).
 */
export function diffStats({ prev, next }: DiffStatsInput): Stats {
  let alive = 0;
  let births = 0;
  let deaths = 0;
  for (let i = 0; i < next.length; i++) {
    alive += next[i];
    if (next[i] === 1 && prev[i] === 0) births++;
    else if (next[i] === 0 && prev[i] === 1) deaths++;
  }
  return { alive, births, deaths };
}

/**
 * mulberry32 — 32-bit-seeded pseudo-random generator (reproducible). Returns [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded random board. Same seed → same board (fixed in tests).
 * When seed is omitted it is taken from the current time (non-deterministic).
 */
export function randomize({ width, height, density, seed }: RandomizeInput): Uint8Array {
  const random = mulberry32(seed ?? Date.now() >>> 0);
  const cells = new Uint8Array(width * height);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = random() < density ? 1 : 0;
  }
  return cells;
}
