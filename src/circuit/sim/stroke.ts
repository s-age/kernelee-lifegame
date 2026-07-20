// circuit/sim/stroke.ts — stroke interpretation (pointer interpretation is owned by circuit).
//
// The visit-interpretation sequence (assemble HitCellInput → hitCell →
// cellVisit switch → divert to the toggle flow) is `strokeMovePipe` — ONE
// flow-bound module constant, not a shared appender: strokeStart reaches it
// by divert (strokeMove.bridge.ts, a decisionless Bridge hop declared on the
// typed tier), because a stroke start IS "arm the state, then interpret the
// start point as the first move". The former `appendStrokeVisit`
// entry-builder appender duplicated these stages into both descriptors; a
// shared TAIL is expressed as pipeline-value composition instead
// (owner-decided 2026-07-19), so the sequence is a single graph node with
// in-degree 2 (the Circuit.Sim.strokeMove bus entry + strokeStart's divert).
//
// The mid-pipe branch switch (cellVisitSwitch) lives in cellVisit.switch.ts
// per the topology classification (branching = *.switch.ts) — it stays a real
// pipe stage (it diverts to togglePipe, a routing verb, never a pre-handler
// veto). The outside-a-stroke veto is the framework GATE
// (`guard:stroke.active`, guarding `Circuit.Sim.strokeMove` —
// circuit/sim/inStroke.gate.ts, bound in driver/wiring.ts's `bindGuards`);
// with no shared appender demanding an entry builder any more, strokeMovePipe
// simply opens directly on its first real stage (the HitCellInput assembly).
// The buffer transitions that call no symbols (armStrokeState / strokeEnd)
// live in stroke.mutator.ts. Only "how the stage sequence is assembled" (the
// symbol-calling saga bodies) remains here.

import { next, pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { LifePort, SimFlowKeys, type NormalizedPoint } from '../../contract/ports';
import { GridState } from '../../contract/states';
import { cellVisitSwitch } from './cellVisit.switch';
import { armStrokeState } from './stroke.mutator';
import { strokeMoveBridge } from './strokeMove.bridge';

/**
 * The visit-interpretation pipe for one stroke point — the shared tail of
 * both stroke entries, flow-bound as `SimFlowKeys.strokeMove`
 * (driver/wiring.ts): assemble `HitCellInput` → hitCell (symbol) → switch
 * (abort on outside-the-board / same-cell repeats) → divert to the toggle
 * flow (a tail call — the toggle's transition handling shares the single
 * toggleCell.ts).
 *
 * The jump target is declared on the TYPED divert tier: `divertsTo` is a map
 * of kernelee `DispatchKey`s (not free strings), so the switch receives a typed
 * `diverts` channel as its third argument, tsc pins the payload to the key's
 * `CellCoord`, and the key is resolved against `builder.flow(...)`'s binding
 * table at runtime (driver/wiring.ts binds `SimFlowKeys.toggleCell` →
 * togglePipe). The descriptor's `divertsTo` strings — what introspection
 * renders — are unchanged (`['Circuit.Sim.toggleCell']`, normalized from the
 * map), so the wiring graph reads exactly as it did on the free-string tier.
 *
 * The outside-a-stroke (hover) veto runs BEFORE this pipe as the framework
 * gate `guard:stroke.active` — dispatch-path only; strokeStart's divert
 * enters here directly, state already armed (see strokeMove.bridge.ts).
 */
export const strokeMovePipe: Pipe<NormalizedPoint, never> = pipeline(
  { note: 'Assemble HitCellInput (board size via buffer read)' },
  (kernel: Kernel, point: NormalizedPoint) => {
    const grid = kernel.buffer.read(GridState);
    return next({ u: point.u, v: point.v, width: grid.width, height: grid.height });
  },
)
  .pipe(LifePort.hitCell)
  .pipe(
    {
      note: 'new cell on board?',
      divertsTo: { toggle: SimFlowKeys.toggleCell },
    },
    cellVisitSwitch,
  )
  .seal();

/**
 * Start: arm the stroke state (no last cell), then divert into the shared
 * visit interpretation (`Circuit.Sim.strokeMove`) — the start point is
 * interpreted as the first move. The hop is a Bridge part
 * (strokeMove.bridge.ts): one fixed destination, no decision.
 */
export const strokeStartPipe: Pipe<NormalizedPoint, void> = pipeline(
  { note: 'Arm the stroke state (no last cell)' },
  armStrokeState,
)
  .pipe(
    {
      note: 'Interpret the start point as the first move (fixed hop into Circuit.Sim.strokeMove)',
      divertsTo: { strokeMove: SimFlowKeys.strokeMove },
    },
    strokeMoveBridge,
  )
  .seal();

export function strokeStart(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeStartPipe, point);
}

export function strokeMove(kernel: Kernel, point: NormalizedPoint): Promise<void> {
  return kernel.run(strokeMovePipe, point);
}
