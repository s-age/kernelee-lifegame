// circuit/sim/generation.ts — the stage sequence for one generation (shared by step and the loop).

import { next, pipeline, runtimeArity, type Kernel, type PipeBuilder } from '@s-age/kernelee';
import { LifePort, type DiffStatsInput } from '../../contract/ports';
import { GridState, type ForkGranularity, type Stats } from '../../contract/states';
import { branchesFor } from './branches';
import { mergeGranularityBranches, packGenerationResult } from './generation.emitter';
import { applyGenerationResult } from './generation.mutator';

/** The product of one generation — the joined board + transition stats. The effect emits to both states. */
export interface GenerationResult {
  readonly cells: Uint8Array;
  readonly stats: Stats;
}

/**
 * Appends one generation's worth of "snapshot → fork → Emitter (join) → fork
 * (board line / stats line) → write" to an arbitrary builder. PipeBuilder is
 * immutable (every method returns a new builder), so both the step variant
 * (single lap) and the loop variant (gated + sleep + divert) call this function
 * and share the stage sequence DRY.
 *
 * The fork's branch count varies with granularity and board size, so the array
 * overload carries `runtimeArity`, declaring to introspection that "the branch
 * count is decided per construction".
 *
 * The downstream effect needs both the new board and the stats — the board
 * travels on a pass-through line, the stats on the diffStats line, and the
 * Emitter (`.map`) hands both to the next stage.
 */
export function appendGeneration<I>(
  entry: PipeBuilder<I, void>,
  granularity: ForkGranularity,
  width: number,
  height: number,
): PipeBuilder<I, GenerationResult> {
  return entry
    .pipe({ note: 'Take a board snapshot (buffer read)' }, (kernel, _cursor) =>
      next(kernel.buffer.read(GridState)),
    )
    .fork(branchesFor(granularity, width, height), runtimeArity)
    .map(mergeGranularityBranches)
    .pipe({ note: 'Assemble the transition pair (the previous generation is still in the pre-write buffer)' }, (kernel, merged) =>
      next({ prev: kernel.buffer.read(GridState).cells, next: merged }),
    )
    .fork(
      pipeline({ note: 'Board line — pass the new board through' }, (_kernel: Kernel, pair: DiffStatsInput) =>
        next(pair.next),
      ),
      pipeline({ note: 'Stats line — distribute the transition pair' }, (_kernel: Kernel, pair: DiffStatsInput) =>
        next(pair),
      ).pipe(LifePort.diffStats),
    )
    .map(packGenerationResult) // Emitter part (generation.emitter.ts): hands both to the next stage (repacking only)
    .effect(applyGenerationResult); // Mutator part (generation.mutator.ts): buffer write only
}
