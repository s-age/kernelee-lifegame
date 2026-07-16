// circuit/sim/stroke.ts — stroke interpretation (pointer interpretation is owned by circuit).
//
// The mid-pipe branch switch (cellVisitSwitch) lives in cellVisit.switch.ts per
// the topology classification (branching = *.switch.ts) — it stays a real
// pipe stage (it diverts to togglePipe, a routing verb, never a pre-handler
// veto). The outside-a-stroke veto (inStrokeGate) is no longer a pipe stage
// at all: it migrated to a framework GATE (`guard:stroke.active`, guarding
// `Circuit.Sim.strokeMove` — circuit/sim/inStroke.gate.ts, bound in
// driver/wiring.ts's `bindGuards`), so `strokeMovePipe`'s own entry stage
// below is now a minimal pass-through. The buffer transitions that call no
// symbols (armStrokeState / strokeEnd) live in stroke.mutator.ts. Only "how
// the stage sequence is assembled" (the symbol-calling saga bodies) remains
// here.

import { next, pipeline, type Kernel, type Pipe, type PipeBuilder } from '@s-age/kernelee';
import { LifePort, SimFlowKeys, type NormalizedPoint } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { cellVisitSwitch } from './cellVisit.switch';
import { armStrokeState } from './stroke.mutator';

/**
 * The interpretation stage sequence for one stroke point (shared by start /
 * move — the same "append to an arbitrary entry" shape as appendGeneration):
 * assemble HitCellInput → hitCell (symbol) → switch (abort on outside-the-board /
 * same-cell repeats) → divert to the toggle flow (a tail call — the toggle's
 * transition handling shares the single toggleCell.ts).
 *
 * The jump target is declared on the TYPED divert tier: `divertsTo` is a map
 * of kernelee `DispatchKey`s (not free strings), so the switch receives a typed
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
        note: 'Switch on outside-the-board / same-cell repeats → update stroke state → on to the toggle',
        divertsTo: { toggle: SimFlowKeys.toggleCell },
      },
      cellVisitSwitch,
    )
    .seal();
}

/** Start: arm the stroke state (no last cell) and interpret the start point. */
export const strokeStartPipe = appendStrokeVisit(
  pipeline({ note: 'Arm the stroke state (no last cell)' }, armStrokeState),
);

/**
 * Continue: moves outside a stroke (hover only) are dropped by the guarding
 * gate before this pipe is ever reached (guard:stroke.active, guarding
 * `Circuit.Sim.strokeMove` — circuit/sim/inStroke.gate.ts), so this entry
 * stage is a minimal pass-through.
 */
export const strokeMovePipe = appendStrokeVisit(
  pipeline(
    { note: 'Enter the stroke-move interpretation (the outside-a-stroke gate already ran as the guarding gate — guard:stroke.active)' },
    (_kernel: Kernel, point: NormalizedPoint) => next(point),
  ),
);

export function strokeStart(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeStartPipe, point);
}

export function strokeMove(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeMovePipe, point);
}
