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
 *
 * **Deliberately the UNCHECKED divert tier** (`diversion(pipe, payload)`, not
 * kernelee's typed `DispatchKey`/`flow()` tier the stroke→toggle hop uses,
 * cellVisit.switch.ts). A typed key must be bound to ONE pipe at wiring time
 * (`builder.flow`), but this hop's target pipe identity is computed per lap
 * from runtime buffer state: `tickLoopPipeFor(granularity, width, height)` is
 * keyed not only by granularity (a closed 3-value union that COULD be three
 * keys) but by the board size read from GridState on this very lap — data the
 * architecture treats as runtime values, not wiring-time constants. Binding
 * three granularity keys at DEFAULT_WIDTH/DEFAULT_HEIGHT would (a) silently
 * pin the loop to wiring-time board dimensions, deleting this stage's
 * GridState read and the "divert target chosen at runtime" showcase it
 * exists to demonstrate, and (b) force cachedPipe's deliberately LAZY 'cell'
 * family (width*height = thousands of branch pipes) to be built eagerly at
 * every kernel build, including every test kernel. The cost of staying
 * unchecked is the documented one: a stale `divertsTo` declaration on the
 * calling stage (tickLoop.ts) is convention-checked by the wiring-graph
 * floors, never by tsc or build().
 */
export function granularitySwitch(kernel: Kernel) {
  const grid = kernel.buffer.read(GridState);
  const nextGranularity = kernel.buffer.read(SimState).granularity;
  return divert(diversion(tickLoopPipeFor(nextGranularity, grid.width, grid.height), undefined));
}
