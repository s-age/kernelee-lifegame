// circuit/sim/randomize.mutator.ts — Mutator part.
//
// The tail `.effect` of randomize.ts (calls no symbols, only writes
// GridState/StatsState) lives here as the bare identifier passed to
// `.effect(applyRandomizeResult)`. A part's identity is (name, kind) — sharing
// the name "randomize" with randomize.emitter.ts is unique (details in the doc
// of advanceGeneration.mutator.ts).

import type { Kernel } from '@s-age/kernelee';
import { GridState, StatsState } from '../../contract/states';
import type { packRandomizeResult } from './randomize.emitter';

/**
 * Copy-on-write: swap in the new cells, reset the generation to 0, and emit the
 * stats as a pair.
 */
export function applyRandomizeResult(kernel: Kernel, result: ReturnType<typeof packRandomizeResult>): void {
  kernel.buffer.mutate(GridState, (grid) => ({ ...grid, cells: result.cells, generation: 0 }));
  // Keep the current reference when the value is unchanged (never make subscribers'
  // change detection fire spuriously with a fresh reference for a no-op write).
  kernel.buffer.mutate(StatsState, (stats) =>
    stats.alive === result.stats.alive &&
    stats.births === result.stats.births &&
    stats.deaths === result.stats.deaths
      ? stats
      : result.stats,
  );
}
