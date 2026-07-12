// circuit/sim/generation.mutator.ts — Mutator part.
//
// A Mutator is "a node whose purpose is writing to buffers" — besides plain
// command handlers (play/pause in running.mutator.ts), write effects inside
// pipes are extracted here too. The tail `.effect` of appendGeneration
// (generation.ts) calls no symbols and only writes GridState/StatsState — a
// pure buffer transition — so it lives here as the bare identifier passed to
// `.effect(applyGenerationResult)`.
//
// A part's identity is (name, kind) — sharing the name "generation" with
// generation.emitter.ts is not a collision; "owning pipeline + role
// suffix" is what makes it unique (PartEntry carries kind/file alongside, and
// the devtools panel also joins on the file key).

import type { Kernel } from '@s-age/kernelee';
import { GridState, StatsState } from '../../contract/states';
import type { GenerationResult } from './generation';

/**
 * Copy-on-write: swap in the new cells array, advance the generation, and emit
 * the stats as a pair.
 *
 * StatsState returns the current reference when the value is unchanged — on a
 * stable board (still life) it is identical every generation, so never make
 * subscribers' change detection fire spuriously with a fresh reference for a
 * no-op write (copy-on-write means "new reference when the value changed", not
 * "new reference on every write"). GridState always really changes because
 * generation advances every lap.
 */
export function applyGenerationResult(kernel: Kernel, result: GenerationResult): void {
  kernel.buffer.mutate(GridState, (grid) => ({
    ...grid,
    cells: result.cells,
    generation: grid.generation + 1,
  }));
  kernel.buffer.mutate(StatsState, (stats) =>
    stats.alive === result.stats.alive &&
    stats.births === result.stats.births &&
    stats.deaths === result.stats.deaths
      ? stats
      : result.stats,
  );
}
