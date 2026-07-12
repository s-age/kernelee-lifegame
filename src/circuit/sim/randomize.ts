// circuit/sim/randomize.ts — random board saga (whatever writes GridState emits StatsState as a pair).

import { next, pipeline, type Kernel } from '@s-age/kernelee';
import { LifePort, type DiffStatsInput } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { packRandomizeResult } from './randomize.emitter';
import { applyRandomizeResult } from './randomize.mutator';

/** Default density of a random board. */
const RANDOMIZE_DENSITY = 0.3;

/**
 * "Assemble input → generate (symbol) → transition pair → fork (board line /
 * stats line) → write". randomize also emits stats as "a transition from the
 * previous board" (StatsState's semantics = the most recent board transition;
 * ticks, hand edits, and randomize are all treated alike).
 * The shape does not depend on arguments (the size is a buffer read at the
 * entry), so it is a module constant.
 */
export const randomizePipe = pipeline(
  { note: 'Assemble RandomizeInput (board size via buffer read)' },
  (kernel: Kernel, _payload: void) => {
    const { width, height } = kernel.buffer.read(GridState);
    return next({ width, height, density: RANDOMIZE_DENSITY });
  },
)
  .pipe(LifePort.randomize)
  .pipe({ note: 'Assemble the transition pair (the previous board is still in the pre-write buffer)' }, (kernel, cells) =>
    next({ prev: kernel.buffer.read(GridState).cells, next: cells }),
  )
  .fork(
    pipeline({ note: 'Board line — pass the new board through' }, (_kernel: Kernel, pair: DiffStatsInput) =>
      next(pair.next),
    ),
    pipeline({ note: 'Stats line — distribute the transition pair' }, (_kernel: Kernel, pair: DiffStatsInput) =>
      next(pair),
    ).pipe(LifePort.diffStats),
  )
  .map(packRandomizeResult) // Emitter part (randomize.emitter.ts): hands both to the next stage (repacking only)
  .effect(applyRandomizeResult) // Mutator part (randomize.mutator.ts): buffer write only
  .seal();

export function randomize(kernel: Kernel): Promise<void> {
  return kernel.run(randomizePipe);
}
