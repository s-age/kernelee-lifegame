// circuit/sim/step.ts — step saga.
//
// **On the serial CommandBus, awaited — the crucial invariant.** `step`
// stays ON the bus, and device.ts's delegate still `kernel.run`s the whole
// thing and AWAITS its completion — that await is what serializes rapid Step
// clicks (one lap completes before the bus lets the next dispatched `step`
// start its own lap).
//
// `.spawn` (play.ts's detached-fork pattern) would run the branch OFF the bus,
// unawaited: two rapid steps would then race concurrent laps writing
// GridState in parallel, because `idlePhaseGate` (guard:loop.idle, guarding
// `Circuit.Sim.step` — circuit/sim/idlePhase.gate.ts) only aborts while
// `LoopState.phase !== 'idle'`, and advanceGeneration never sets phase to
// anything else — nothing else would stop the second lap from starting
// before the first finishes. The generation loop IS `.spawn`ed because it is
// a single long-lived daemon guarded by `launchArm`'s double-start gate;
// `step` is a one-shot lap with no such guard, so serialization must come
// from the bus itself, not from the launch verb.
//
// **Reaches the generation sequence as a SYMBOL, not a divert.** Before,
// `step` diverted (in-pipe, on-bus) into a separate one-lap pipe
// (`stepOncePipe`, `stepOnce.bridge.ts`, both now deleted). The generation
// stage sequence is now owned by a single pipe,
// `advanceGenerationPipe` (advanceGeneration.ts), bound to the port symbol
// `Circuit.Sim.advanceGeneration` — `step`'s pipe is that symbol and nothing
// else, entered via the `pipeline(symbol)` overload (a symbol-only,
// one-stage pipe). This is a deliberate difference from tickLoop's
// reference to the same symbol: tickLoop has stages AFTER the generation
// (sleep, self-divert), so it composes via `.tap(sym)` (persist-and-continue,
// mid-pipe); step's entire pipe IS the one predefined process, so it
// composes via the symbol-entry form instead. Both forward a `void` cursor,
// so the two reference shapes are behaviourally identical here — the choice
// is about what comes after, not about the symbol itself.

import { pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { SimPort } from '../../contract/ports';

/**
 * The step saga: a single-stage pipe that IS the
 * `Circuit.Sim.advanceGeneration` symbol (`pipeline(symbol)` — no further
 * stage of its own, so no anonymous entry stage is needed). The idle-phase
 * gate (the "never step while running" invariant) runs as a framework gate
 * guarding `Circuit.Sim.step` itself (circuit/sim/idlePhase.gate.ts, bound
 * in driver/wiring.ts's `bindGuards`) — BEFORE this pipe's one stage is even
 * reached.
 */
export const stepPipe: Pipe<void, void> = pipeline(SimPort.advanceGeneration).seal();

/**
 * One-line delegate — device.ts stays a zero-logic catalog. `kernel.run`
 * STAYS an ON-BUS awaited launch (not fire-and-forget): the dispatch bus
 * awaits this promise, which is what keeps rapid Step clicks serialized.
 */
export function step(kernel: Kernel): Promise<void> {
  return kernel.run(stepPipe);
}
