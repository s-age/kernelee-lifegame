// circuit/sim/inStroke.switch.ts — Switch part.
//
// A Switch "only translates the device's decision into a verb (next/abort)" —
// this decision is StrokeState.active. It holds no writes: a pure selects-only
// Switch (no exception needed).
//
// Passed as a bare identifier to `pipeline(meta, inStrokeGate)` (as a named
// handler it has an address in the index's StageEntry.handler).

import { abort, next, type Kernel } from '@s-age/kernelee';
import type { NormalizedPoint } from '../../contract/ports';
import { StrokeState } from '../../contract/states';

/** Outside-a-stroke gate (a move without a start aborts). */
export function inStrokeGate(kernel: Kernel, point: NormalizedPoint) {
  return kernel.buffer.read(StrokeState).active ? next(point) : abort(undefined);
}
