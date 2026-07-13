// circuit/sim/step.ts — step saga.
//
// **divert, not spawn** — the crucial difference from play.ts/tickLoop.ts,
// despite the identical STRUCTURE (a distinct catalogued saga node reached
// via a granularity switch that declares `divertsTo`). `step` stays ON the
// serial CommandBus: its pipe diverts (in-pipe, on-bus) into
// `stepOncePipeFor` for exactly one lap, and device.ts's delegate still
// `kernel.run`s the whole thing and AWAITS its completion — that await is
// what serializes rapid Step clicks (one lap completes before the bus lets
// the next dispatched `step` start its own divert).
//
// `.spawn` (play.ts's detached-fork pattern) would run the branch OFF the bus,
// unawaited: two rapid steps would then race concurrent laps writing
// GridState in parallel, because `idlePhaseGate` (inside stepOncePipeFor)
// only aborts while `LoopState.phase !== 'idle'`, and stepOnce never sets
// phase to anything else — nothing else would stop the second lap from
// starting before the first finishes. The generation loop IS `.spawn`ed
// because it is a single long-lived daemon guarded by `launchArm`'s
// double-start gate; `step` is a one-shot lap with no such guard, so
// serialization must come from the bus itself, not from the launch verb.
//
// This switch's calling stage below is stepOnce's one real external
// referrer — the graph edge that resolves stepOnce's former orphanEntry (see
// scripts/wiringIssueAllowlist.ts).

import { pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { stepGranularitySwitch } from './stepGranularity.switch';
import { CircuitSimKeys } from './wiringKeys';

/**
 * The step saga: a single-stage pipe that diverts into the size/granularity-
 * specific one-lap pipe (`stepOncePipeFor`). Declares `divertsTo:
 * [CircuitSimKeys.stepOnce]` — the graph edge that resolves stepOnce's former
 * orphanEntry. The idle-phase gate (the "never step while running" invariant)
 * lives INSIDE stepOncePipeFor's own entry stage (idlePhase.switch.ts via
 * appendGeneration), so it runs AFTER this divert — it is not duplicated
 * here.
 */
export const stepPipe: Pipe<void, void> = pipeline(
  {
    note: 'Enter the manual step lap (divert target selected at runtime by granularity)',
    divertsTo: [CircuitSimKeys.stepOnce],
  },
  stepGranularitySwitch,
).seal();

/**
 * One-line delegate — device.ts stays a zero-logic catalog. `kernel.run`
 * STAYS an ON-BUS awaited launch (not fire-and-forget): the dispatch bus
 * awaits this promise, which is what keeps rapid Step clicks serialized.
 */
export function step(kernel: Kernel): Promise<void> {
  return kernel.run(stepPipe);
}
