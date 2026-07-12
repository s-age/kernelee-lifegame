// circuit/sim/cache.ts — pipe cache (granularity × board size).

import type { ForkGranularity } from '../../contract/states';

/**
 * Memoization helper that shares a built pipe per (granularity, width, height).
 * Returning the same Pipe value for the same key is what preserves the "self"
 * of the divert — as long as the granularity does not change, the loop keeps
 * diverting to literally the same instance.
 * The 'cell' granularity carries width*height branches, so construction is
 * deferred until first request. Pipes are kernel-independent (the kernel is
 * passed at stage execution time), so they may be shared process-wide. The Map
 * is owned by each saga's file (tickLoop.ts / stepOnce.ts).
 */
export function cachedPipe<P>(
  cache: Map<string, P>,
  granularity: ForkGranularity,
  width: number,
  height: number,
  build: () => P,
): P {
  const key = `${granularity}:${width}x${height}`;
  let pipe = cache.get(key);
  if (!pipe) {
    pipe = build();
    cache.set(key, pipe);
  }
  return pipe;
}
