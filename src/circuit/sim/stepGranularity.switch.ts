// circuit/sim/stepGranularity.switch.ts — Switch part.
//
// A Switch is "selection only": it receives the device's decision as data and
// merely translates it into a verb (next/abort/divert). It is named after the
// **decision**, not the destination (canon: StreamVerdict+Switch) — the
// decision here is SimState.granularity, the same decision
// granularity.switch.ts's `granularitySwitch` makes for the tick loop. The
// fan-out target (divertsTo) lives on the calling stage's descriptor
// (step.ts), not here.

import { divert, diversion, type Kernel } from '@s-age/kernelee';
import { GridState, SimState } from '../../contract/states';
import { stepOncePipeFor } from './stepOnce';

/**
 * ONE-SHOT divert, not a self-divert: `step`'s pipe diverts into
 * `stepOncePipeFor` for exactly one lap and stops there — the destination
 * pipe carries no divert of its own (unlike the tick loop's self-reloading
 * `granularitySwitch`, whose destination set includes its own pipe). It does
 * not interpret the contents of granularity (it stays a pure
 * granularity→pipe lookup) — if interpretation were needed, that would be
 * Compute's job.
 *
 * **Deliberately the UNCHECKED divert tier** (`diversion(pipe, payload)`, not
 * kernelee's typed `DispatchKey`/`flow()` tier), for the identical reason
 * `granularitySwitch` is unchecked — see granularity.switch.ts's doc comment
 * for the full reasoning. In short: the destination pipe identity is computed
 * per call from runtime buffer state — `stepOncePipeFor(granularity, width,
 * height)` is keyed not only by granularity (a closed 3-value union that
 * COULD be three keys) but by the board size read from GridState on this very
 * call, data the architecture treats as a runtime value, not a wiring-time
 * constant. Binding three granularity keys at DEFAULT_WIDTH/DEFAULT_HEIGHT
 * would silently pin manual stepping to wiring-time board dimensions and
 * force cachedPipe's deliberately LAZY 'cell' family (width*height branch
 * pipes) to build eagerly at every kernel build, including every test kernel.
 * The cost of staying unchecked is the documented one: a stale `divertsTo`
 * declaration on the calling stage (step.ts) is convention-checked by the
 * wiring-graph floors, never by tsc or build().
 */
export function stepGranularitySwitch(kernel: Kernel) {
  const grid = kernel.buffer.read(GridState);
  const { granularity } = kernel.buffer.read(SimState);
  return divert(diversion(stepOncePipeFor(granularity, grid.width, grid.height), undefined));
}
