// circuit/sim/stroke.ts — stroke interpretation (pointer interpretation is owned by circuit).
//
// The branch gates (cellVisitGate / inStrokeGate) live in cellVisit.switch.ts /
// inStroke.switch.ts per the topology classification (branching = *.switch.ts).
// The buffer transitions that call no symbols (armStrokeState / strokeEnd) live
// in stroke.mutator.ts. Only "how the stage sequence is assembled" (the
// symbol-calling saga bodies) remains here.

import { next, pipeline, type Kernel, type Pipe, type PipeBuilder } from '@s-age/kernelee';
import { LifePort, SimFlowKeys, type NormalizedPoint } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { cellVisitGate } from './cellVisit.switch';
import { inStrokeGate } from './inStroke.switch';
import { armStrokeState } from './stroke.mutator';

/**
 * The interpretation stage sequence for one stroke point (shared by start /
 * move — the same "append to an arbitrary entry" shape as appendGeneration):
 * assemble HitCellInput → hitCell (symbol) → gate (abort on outside-the-board /
 * same-cell repeats) → divert to the toggle flow (a tail call — the toggle's
 * transition handling shares the single toggleCell.ts).
 *
 * The jump target is declared on the TYPED divert tier: `divertsTo` is a map
 * of kernelee `DispatchKey`s (not free strings), so the gate receives a typed
 * `diverts` channel as its third argument, tsc pins the payload to the key's
 * `CellCoord`, and the key is resolved against `builder.flow(...)`'s binding
 * table at runtime (driver/wiring.ts binds `SimFlowKeys.toggleCell` →
 * togglePipe). The descriptor's `divertsTo` strings — what introspection
 * renders — are unchanged (`['Circuit.Sim.toggleCell']`, normalized from the
 * map), so the wiring graph reads exactly as it did on the free-string tier.
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
        divertsTo: { toggle: SimFlowKeys.toggleCell },
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
