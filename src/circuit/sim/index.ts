// circuit/sim — tick loop (saga). The public surface is simDevice only (wiring lives in driver).
//
// Follows the saga / Switch / Emitter / Bridge taxonomy.
// The `+` of part files becomes a dot-suffix in TS (*.switch.ts / *.emitter.ts / *.bridge.ts).
// `*.gate.ts` is a deliberate NON-part suffix: a framework interceptor/gate
// (declareGate/KernelBuilder.guard) declaration, bound in driver/wiring.ts's
// bindGuards — it runs before its guarded port symbol's handler is even
// invoked, so it has no stage-link chain and is invisible to the
// switch/emitter/mutator/bridge part-file topology.
//
//   play.ts                    saga: minimal entry then .spawn the detached generation loop
//                              (the detached-fork-branch launch; the visible edge to tickLoop)
//   launchArm.gate.ts          Gate: guard:loop.launchArm, the double-start guard (idle → launch
//                              fresh / else recover-only), guarding Circuit.Sim.play; its LoopState
//                              write is a declared CI-floor exception (inseparable from the decision)
//   tickLoop.ts                saga: self-diverting generation loop (module constant; play's .spawn
//                              launcher and the loop's own lap-end both divert here). Composes one
//                              generation via .tap(Circuit.Sim.advanceGeneration) (mid-pipe symbol stage)
//   tickLoop.bridge.ts         Bridge: fixed hop into Circuit.Sim.tickLoop — no decision, since
//                              fork(symbol) absorbed the former per-(granularity, size) pipe choice
//   step.ts                    saga: single-stage pipe that IS the Circuit.Sim.advanceGeneration symbol
//                              (pipeline(symbol), on-bus, awaited — rapid clicks stay serialized)
//   idlePhase.gate.ts          Gate: guard:loop.idle, guarding Circuit.Sim.step (abort unless idle)
//   toggleCell.ts              saga: cell-flip transition (the GridState write is the declared
//                              CI-floor exception for transitions inseparable from the
//                              decision. StatsState lives in toggleCell.mutator.ts)
//   toggleCell.mutator.ts      Mutator: toggleCell's StatsState-reflecting effect
//   randomize.ts               saga: random board transition (symbol call + fork)
//   randomize.mutator.ts       Mutator: randomize's paired GridState + StatsState emit
//   advanceGeneration.emitter.ts Emitter: folds the post-fork(symbol) results into a single board
//   advanceGeneration.ts       saga: the stage sequence for one generation, bound to the port symbol
//                              Circuit.Sim.advanceGeneration (referenced, not appended, by tickLoop
//                              and step) — partitionRanges (symbol) → fork(stepIndexRange, symbol)
//   advanceGeneration.mutator.ts Mutator: advanceGenerationPipe's paired GridState + StatsState emit
//   stroke.ts                  saga: stroke interpretation — strokeMovePipe is the shared
//                              visit-interpretation pipe (flow-bound), strokeStart diverts into it
//   strokeMove.bridge.ts       Bridge: strokeStart's fixed hop into Circuit.Sim.strokeMove (the
//                              start point is interpreted as the first move; carries the cursor)
//   inStroke.gate.ts           Gate: guard:stroke.active, guarding Circuit.Sim.strokeMove
//                              (a move without a start aborts)
//   stroke.mutator.ts          Mutator: armStrokeState (strokeStart's entry) / strokeEnd
//   running.mutator.ts         Mutator: pause (a pure LoopState transition that calls no symbols;
//                              play graduated to a saga when its launch became a .spawn)
//   device.ts                  SimDevice catalog (mapping of port symbols to implementations, one-line delegates)
//
// Settings are an independent family (circuit/settings/ = Circuit.Settings).

export { simDevice } from './device';
