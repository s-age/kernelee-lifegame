// ComputeTests — pure logic (B3/S23, torus, chunks, seed reproducibility).
// compute is pure functions, so it is imported and tested directly (no kernel needed).

import { describe, expect, it } from 'vitest';
import { diffStats, hitCell, partitionRanges, randomize, stepIndexRange } from '../src/compute/life';
import { CHUNK_COUNT, type ForkGranularity } from '../src/contract/states';

/** Build a board from a coordinate list. */
function fromCoords(width: number, height: number, coords: ReadonlyArray<readonly [number, number]>): Uint8Array {
  const cells = new Uint8Array(width * height);
  for (const [x, y] of coords) cells[y * width + x] = 1;
  return cells;
}

/** Advance every cell one generation as a single range (the full-board case). */
function fullStep(cells: Uint8Array, width: number, height: number): Uint8Array {
  return stepIndexRange({ cells, width, height, start: 0, end: width * height });
}

/** Advance one generation as N row chunks and join (the same split formula as circuit's fork+join). */
function chunkedStep(cells: Uint8Array, width: number, height: number, chunkCount: number): Uint8Array {
  const merged = new Uint8Array(width * height);
  for (let i = 0; i < chunkCount; i++) {
    const start = Math.floor((height * i) / chunkCount) * width;
    const end = Math.floor((height * (i + 1)) / chunkCount) * width;
    merged.set(stepIndexRange({ cells, width, height, start, end }), start);
  }
  return merged;
}

describe('Compute.Life.stepIndexRange — B3/S23', () => {
  it('a blinker oscillates with period 2', () => {
    const horizontal = fromCoords(5, 5, [[1, 2], [2, 2], [3, 2]]);
    const vertical = fromCoords(5, 5, [[2, 1], [2, 2], [2, 3]]);
    const gen1 = fullStep(horizontal, 5, 5);
    expect(gen1).toEqual(vertical);
    expect(fullStep(gen1, 5, 5)).toEqual(horizontal);
  });

  it('a block is stable', () => {
    const block = fromCoords(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]]);
    expect(fullStep(block, 4, 4)).toEqual(block);
  });

  it('a glider moves (+1, +1) in 4 generations', () => {
    const glider = fromCoords(8, 8, [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]);
    let cells = glider;
    for (let i = 0; i < 4; i++) cells = fullStep(cells, 8, 8);
    const shifted = fromCoords(8, 8, [[2, 1], [3, 2], [1, 3], [2, 3], [3, 3]]);
    expect(cells).toEqual(shifted);
  });

  it('a glider straddling a chunk boundary (rowEnd) still matches under the all-chunk join', () => {
    // Split 8 rows into 4 chunks (boundaries y=2,4,6). Place the glider at
    // y=3..5 so it straddles the rowEnd=4 boundary.
    const glider = fromCoords(8, 8, [[1, 3], [2, 4], [0, 5], [1, 5], [2, 5]]);
    let full = glider;
    let chunked = glider;
    for (let i = 0; i < 8; i++) {
      full = fullStep(full, 8, 8);
      chunked = chunkedStep(chunked, 8, 8, 4);
      expect(chunked).toEqual(full);
    }
    // After 8 generations it is (+2, +2) — direct verification that it moved correctly across the boundary.
    expect(chunked).toEqual(fromCoords(8, 8, [[3, 5], [4, 6], [2, 7], [3, 7], [4, 7]]));
  });

  it('stepIndexRange returns only its assigned range (range aligned to row boundaries)', () => {
    const cells = new Uint8Array(5 * 8);
    const out = stepIndexRange({ cells, width: 5, height: 8, start: 2 * 5, end: 6 * 5 });
    expect(out.length).toBe((6 - 2) * 5);
  });

  it('torus boundary: a blinker straddling the top/bottom edges wraps and oscillates', () => {
    // A vertical blinker at y=4,0,1 (wrapping bottom edge → top edge). The next
    // generation is a horizontal blinker in row 0.
    const wrapped = fromCoords(5, 5, [[2, 4], [2, 0], [2, 1]]);
    const horizontal = fromCoords(5, 5, [[1, 0], [2, 0], [3, 0]]);
    expect(fullStep(wrapped, 5, 5)).toEqual(horizontal);
    expect(fullStep(horizontal, 5, 5)).toEqual(wrapped);
  });

  it('torus boundary: a block straddling the left/right edges is stable', () => {
    const block = fromCoords(6, 4, [[5, 1], [0, 1], [5, 2], [0, 2]]);
    expect(fullStep(block, 6, 4)).toEqual(block);
  });
});

/** Width-1-range version of stepIndexRange (a test wrapper shaped like a per-cell call). */
function stepCell({
  cells,
  width,
  height,
  x,
  y,
}: {
  readonly cells: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}): number {
  const index = y * width + x;
  return stepIndexRange({ cells, width, height, start: index, end: index + 1 })[0]!;
}

describe('Compute.Life.stepIndexRange — equivalence with width-1 ranges (cell granularity)', () => {
  it('the 3 rules — birth, survival, death (horizontal blinker)', () => {
    const horizontal = fromCoords(5, 5, [[1, 2], [2, 2], [3, 2]]);
    expect(stepCell({ cells: horizontal, width: 5, height: 5, x: 2, y: 2 })).toBe(1); // survival (2 neighbours)
    expect(stepCell({ cells: horizontal, width: 5, height: 5, x: 2, y: 1 })).toBe(1); // birth (3 neighbours)
    expect(stepCell({ cells: horizontal, width: 5, height: 5, x: 1, y: 2 })).toBe(0); // death (1 neighbour)
  });

  it('every cell of a random board (torus corners and edges included) matches the full-range result (fullStep)', () => {
    const width = 12;
    const height = 9;
    const cells = randomize({ width, height, density: 0.4, seed: 11 });
    const full = fullStep(cells, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        expect(stepCell({ cells, width, height, x, y }), `cell (${x}, ${y})`).toBe(
          full[y * width + x],
        );
      }
    }
  });
});

describe('Compute.Life.partitionRanges — payload-list partition (fork(symbol)\'s upstream)', () => {
  const GRANULARITIES: readonly ForkGranularity[] = ['chunk', 'row', 'cell'];

  /** Full coverage: sorted ranges concatenate to exactly [0, width*height) with no gap and no overlap. */
  function assertFullNonOverlappingCoverage(
    ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
    width: number,
    height: number,
  ): void {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const { start, end } of sorted) {
      expect(start).toBe(cursor); // no gap, no overlap
      expect(end).toBeGreaterThanOrEqual(start);
      cursor = end;
    }
    expect(cursor).toBe(width * height); // covers the whole board
  }

  for (const granularity of GRANULARITIES) {
    it(`${granularity}: returns ≥1 payload, non-overlapping row-major ranges covering the whole board, sharing one cells reference`, () => {
      const width = 6;
      const height = 5;
      const cells = randomize({ width, height, density: 0.4, seed: 3 });
      const payloads = partitionRanges({ cells, width, height, granularity });

      expect(payloads.length).toBeGreaterThanOrEqual(1);
      // row-major order: the returned list itself is already sorted by start.
      for (let i = 1; i < payloads.length; i++) {
        expect(payloads[i]!.start).toBeGreaterThanOrEqual(payloads[i - 1]!.end);
      }
      assertFullNonOverlappingCoverage(payloads, width, height);
      // Every payload is a complete StepIndexRangeInput, and cells is the SAME
      // reference across every element (never copied).
      for (const payload of payloads) {
        expect(payload.cells).toBe(cells);
        expect(payload.width).toBe(width);
        expect(payload.height).toBe(height);
      }
    });
  }

  it('chunk: exactly CHUNK_COUNT payloads', () => {
    const payloads = partitionRanges({ cells: new Uint8Array(6 * 5), width: 6, height: 5, granularity: 'chunk' });
    expect(payloads).toHaveLength(CHUNK_COUNT);
  });

  it('row: exactly height payloads, one row each', () => {
    const width = 6;
    const height = 5;
    const payloads = partitionRanges({ cells: new Uint8Array(width * height), width, height, granularity: 'row' });
    expect(payloads).toHaveLength(height);
    expect(payloads.every((p) => p.end - p.start === width)).toBe(true);
  });

  it('cell: exactly width*height payloads, one cell each', () => {
    const width = 6;
    const height = 5;
    const payloads = partitionRanges({ cells: new Uint8Array(width * height), width, height, granularity: 'cell' });
    expect(payloads).toHaveLength(width * height);
    expect(payloads.every((p) => p.end - p.start === 1)).toBe(true);
  });

  it('a 1x1 board (the w,h ≥ 1 floor) still yields ≥1 payload covering the single cell, at every granularity', () => {
    for (const granularity of GRANULARITIES) {
      const payloads = partitionRanges({ cells: new Uint8Array(1), width: 1, height: 1, granularity });
      expect(payloads.length).toBeGreaterThanOrEqual(1);
      assertFullNonOverlappingCoverage(payloads, 1, 1);
    }
  });
});

describe('Compute.Life.hitCell — normalized coordinates → cell coordinates', () => {
  it('resolves to the origin, center, and edge cells', () => {
    expect(hitCell({ u: 0, v: 0, width: 64, height: 48 })).toEqual({ x: 0, y: 0 });
    expect(hitCell({ u: 0.5, v: 0.5, width: 64, height: 48 })).toEqual({ x: 32, y: 24 });
    expect(hitCell({ u: 0.999, v: 0.999, width: 64, height: 48 })).toEqual({ x: 63, y: 47 });
  });

  it('outside the board (outside [0,1)) is null', () => {
    expect(hitCell({ u: 1, v: 0.5, width: 64, height: 48 })).toBeNull(); // u=1 means x=width
    expect(hitCell({ u: 0.5, v: 1, width: 64, height: 48 })).toBeNull();
    expect(hitCell({ u: -0.01, v: 0.5, width: 64, height: 48 })).toBeNull();
  });
});

describe('Compute.Life.diffStats — board transition stats', () => {
  it('blinker horizontal → vertical: alive 3 / births 2 / deaths 2', () => {
    const horizontal = fromCoords(5, 5, [[1, 2], [2, 2], [3, 2]]);
    const vertical = fromCoords(5, 5, [[2, 1], [2, 2], [2, 3]]);
    expect(diffStats({ prev: horizontal, next: vertical })).toEqual({
      alive: 3,
      births: 2,
      deaths: 2,
    });
  });

  it('a stable block has births/deaths 0', () => {
    const block = fromCoords(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]]);
    expect(diffStats({ prev: block, next: block })).toEqual({ alive: 4, births: 0, deaths: 0 });
  });
});

describe('Compute.Life.randomize — seed reproducibility', () => {
  it('the same seed returns the same board', () => {
    const a = randomize({ width: 32, height: 24, density: 0.3, seed: 42 });
    const b = randomize({ width: 32, height: 24, density: 0.3, seed: 42 });
    expect(a).toEqual(b);
  });

  it('different seeds return different boards', () => {
    const a = randomize({ width: 32, height: 24, density: 0.3, seed: 1 });
    const b = randomize({ width: 32, height: 24, density: 0.3, seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('the live count is proportionate to density (±10% band)', () => {
    const cells = randomize({ width: 100, height: 100, density: 0.3, seed: 7 });
    const alive = cells.reduce<number>((sum, cell) => sum + cell, 0);
    expect(alive).toBeGreaterThan(10000 * 0.2);
    expect(alive).toBeLessThan(10000 * 0.4);
  });

  it('density 0 kills everything, density 1 fills everything', () => {
    expect(randomize({ width: 10, height: 10, density: 0, seed: 3 }).every((c) => c === 0)).toBe(true);
    expect(randomize({ width: 10, height: 10, density: 1, seed: 3 }).every((c) => c === 1)).toBe(true);
  });
});
