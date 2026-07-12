// circuit/sim/granularity.switch.ts — Switch part.
//
// A Switch is "selection only": it receives the device's decision as data and
// merely translates it into a verb (next/abort/divert). It is named after the
// **decision**, not the destination (canon: StreamVerdict+Switch) — the
// decision here is SimState.granularity. The fan-out targets (divertsTo) live
// on the calling stage's descriptor.

import { divert, diversion, type Kernel } from '@s-age/kernelee';
import { GridState, SimState } from '../../contract/states';
import { tickLoopPipeFor } from './tickLoop';

/**
 * Self-divert Switch (loop reload): the destination set includes its own pipe —
 * the framework guarantees iteration (O(1) stack), so never rewrite this as a
 * recursive call. It does not interpret the contents of granularity (it stays a
 * pure granularity→pipe lookup) — if interpretation were needed, that would be
 * Compute's job. When the granularity is unchanged the cache returns the same
 * instance, so the divert is a self-divert.
 * The mutual reference with tickLoop resolves lazily (at call time), so the
 * circular import is safe.
 */
export function granularitySwitch(kernel: Kernel) {
  const grid = kernel.buffer.read(GridState);
  const nextGranularity = kernel.buffer.read(SimState).granularity;
  return divert(diversion(tickLoopPipeFor(nextGranularity, grid.width, grid.height), undefined));
}
