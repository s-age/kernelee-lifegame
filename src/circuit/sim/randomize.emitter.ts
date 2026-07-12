// circuit/sim/randomize.emitter.ts — Emitter part.
//
// An Emitter is "aggregation only". It is named after the pipeline that owns
// the fork (randomizePipe). It has the same shape as generation.ts's
// packGenerationResult (merely repacking the two-branch board-line / stats-line
// fork into `{ cells, stats }`), but the owning pipeline differs, so per
// the `<OwnerPipe>+Emitter` convention it gets its own file and name.

import type { Stats } from '../../contract/states';

/**
 * Repack the result `[cells, stats]` of the two-branch board-line / stats-line
 * fork into a single result. Shape work only (repacking) — no judgment involved.
 */
export function packRandomizeResult([cells, stats]: readonly [Uint8Array, Stats]): {
  readonly cells: Uint8Array;
  readonly stats: Stats;
} {
  return { cells, stats };
}
