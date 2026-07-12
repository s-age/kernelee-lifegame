// circuit/sim/generation.emitter.ts — Emitter part.
//
// An Emitter is "aggregation only": it shapes the post-fork branch results into
// a single value and passes it on. It is named after the pipeline that owns the
// fork (the generation stage sequence = appendGeneration; tickLoop and stepOnce
// both share appendGeneration, so this Emitter is named as "owned by
// generation" too).
//
// appendGeneration holds two forks, and this single file handles both joins:
// 1. joining the granularity fork (branchesFor) — mergeGranularityBranches
// 2. pairing up the two-branch board-line / stats-line fork — packGenerationResult
//
// Both are passed to `.map` as **bare identifiers** (as chain-link arguments,
// kernel-introspect records them as named handlers with an address in
// StageEntry.handler — no scanner changes needed). The joined length is
// determined by the sum of the parts' own lengths (every granularity partitions
// the board exactly), which is what lets these take no width/height arguments
// and be passed as bare identifiers.

import type { BranchResult } from './branches';
import type { Stats } from '../../contract/states';

/**
 * Join the branch results returned in preserved order (a Uint8Array of the
 * range at every granularity) into a single board. Shape work only (join and
 * repacking) — aggregation (alive/births/deaths) involves judgment, so the
 * Emitter does not do it; the next stage hands it to a Compute symbol
 * (diffStats). The total length is the sum of the parts' own lengths
 * (= width*height, since every granularity partitions the board exactly), so
 * width/height are not taken as arguments.
 */
export function mergeGranularityBranches(parts: ReadonlyArray<BranchResult>): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

/**
 * Repack the result `[cells, stats]` of the two-branch board-line / stats-line
 * fork into a single GenerationResult shape. Shape work only (repacking) — no
 * judgment involved.
 */
export function packGenerationResult([cells, stats]: readonly [Uint8Array, Stats]): {
  readonly cells: Uint8Array;
  readonly stats: Stats;
} {
  return { cells, stats };
}
