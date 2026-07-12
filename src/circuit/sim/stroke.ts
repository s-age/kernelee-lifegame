// circuit/sim/stroke.ts — stroke interpretation (pointer interpretation is owned by circuit).
//
// The branch gates (cellVisitGate / inStrokeGate) live in cellVisit.switch.ts /
// inStroke.switch.ts per the topology classification (branching = *.switch.ts).
// The buffer transitions that call no symbols (armStrokeState / strokeEnd) live
// in stroke.mutator.ts. Only "how the stage sequence is assembled" (the
// symbol-calling saga bodies) remains here.

import { next, pipeline, type Kernel, type Pipe, type PipeBuilder } from '@s-age/kernelee';
import { LifePort, SimPort, type NormalizedPoint } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { cellVisitGate } from './cellVisit.switch';
import { inStrokeGate } from './inStroke.switch';
import { armStrokeState } from './stroke.mutator';

/**
 * The interpretation stage sequence for one stroke point (shared by start /
 * move — the same "append to an arbitrary entry" shape as appendGeneration):
 * assemble HitCellInput → hitCell (symbol) → gate (abort on outside-the-board /
 * same-cell repeats) → divert to togglePipe (a tail call — the toggle's
 * transition handling shares the single toggleCell.ts, and the jump target is
 * declared to introspection via divertsTo).
 */
function appendStrokeVisit(entry: PipeBuilder<NormalizedPoint, NormalizedPoint>): Pipe<NormalizedPoint, never> {
  return entry
    .pipe({ note: 'Assemble HitCellInput (board size via buffer read)' }, (kernel, point) => {
      const grid = kernel.buffer.read(GridState);
      return next({ u: point.u, v: point.v, width: grid.width, height: grid.height });
    })
    .pipe(LifePort.hitCell)
    .pipe(
      {
        note: 'Gate on outside-the-board / same-cell repeats → update stroke state → on to the toggle',
        divertsTo: [SimPort.toggleCell.id],
      },
      cellVisitGate,
    )
    .seal();
}

/** Start: arm the stroke state (no last cell) and interpret the start point. */
export const strokeStartPipe = appendStrokeVisit(
  pipeline({ note: 'Arm the stroke state (no last cell)' }, armStrokeState),
);

/** Continue: moves outside a stroke (hover only) are dropped at the entry gate. */
export const strokeMovePipe = appendStrokeVisit(
  pipeline({ note: 'Outside-a-stroke gate (a move without a start aborts)' }, inStrokeGate),
);

export function strokeStart(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeStartPipe, point);
}

export function strokeMove(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeMovePipe, point);
}
