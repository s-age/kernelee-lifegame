// circuit/sim/stroke.mutator.ts — Mutator part.
//
// Collects the StrokeState Mutators in one file (the same style as
// running.mutator.ts collecting play/pause on the LoopState.phase transition
// axis). stroke.ts keeps strokeStartPipe / strokeMovePipe (pipe assembly, the
// symbol-calling sagas), while the two that are pure buffer transitions
// calling no symbols live here:
//
//   armStrokeState  the **entry** of strokeStartPipe (a bare identifier, so as
//                   a named handler at the entry position it has an address in
//                   the index). It only arms the stroke state and calls no
//                   symbols. The note string lives at the call site in
//                   stroke.ts (`pipeline({ note: '...' }, armStrokeState)`).
//   strokeEnd       a plain Mutator handler (it calls no symbols, so it is not
//                   made a pipe).

import { next, type Kernel } from '@s-age/kernelee';
import type { NormalizedPoint } from '../../contract/ports';
import { StrokeState } from '../../contract/states';

// Both return the current reference when the value is unchanged — never make
// subscribers' change detection fire spuriously with a fresh reference for a
// no-op write. strokeEnd in particular is sent by the view (a pure sensor) from
// both pointerUp and pointerLeave (it arrives on every mouse leave outside a
// stroke), so overwriting "already inactive" happens routinely.

/** Start: arm the stroke state (no last cell) and pass the start point on unchanged. */
export function armStrokeState(kernel: Kernel, point: NormalizedPoint) {
  kernel.buffer.mutate(StrokeState, (stroke) =>
    stroke.active && stroke.last === null ? stroke : { active: true, last: null },
  );
  return next(point);
}

/** End: merely discard the state — it calls no symbols, so it is not a pipe (Mutator). */
export function strokeEnd(kernel: Kernel): void {
  kernel.buffer.mutate(StrokeState, (stroke) =>
    !stroke.active && stroke.last === null ? stroke : { active: false, last: null },
  );
}
