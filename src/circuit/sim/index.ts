// circuit/sim — tick loop (saga). The public surface is simDevice only (wiring lives in driver).
//
// Follows the saga / Switch / Emitter taxonomy.
// The `+` of part files becomes a dot-suffix in TS (*.switch.ts / *.emitter.ts).
//
//   play.ts                    saga: arm the loop phase then .spawn the detached generation loop
//                              (the detached-fork-branch launch; the visible edge to tickLoop)
//   launchArm.switch.ts        Switch: the double-start guard (idle → launch fresh / else recover-only);
//                              its LoopState write is a declared CI-floor exception (inseparable from the decision)
//   tickLoop.ts                saga: divert generation loop (+ tickLoopLauncherPipe, play's .spawn branch)
//   step.ts                    saga: single-stage pipe that diverts into stepOnce (on-bus, awaited —
//                              the visible edge to stepOnce; divert not spawn, so rapid clicks stay serialized)
//   stepGranularity.switch.ts  Switch: translates the decision (granularity) into stepOnce's divert
//                              target (one-shot, not a self-divert)
//   stepOnce.ts                saga: one gated lap
//   toggleCell.ts              saga: cell-flip transition (the GridState write is the declared
//                              CI-floor exception for transitions inseparable from the
//                              decision. StatsState lives in toggleCell.mutator.ts)
//   toggleCell.mutator.ts      Mutator: toggleCell's StatsState-reflecting effect
//   randomize.ts               saga: random board transition (symbol call + fork)
//   randomize.mutator.ts       Mutator: randomize's paired GridState + StatsState emit
//   granularity.switch.ts      Switch: translates the decision (granularity) into a divert target (self-divert reload)
//   generation.emitter.ts      Emitter: folds the post-fork branch results into a single board
//   generation.ts              the shared stage sequence for one generation (tickLoop and stepOnce append to it)
//   generation.mutator.ts      Mutator: appendGeneration's paired GridState + StatsState emit
//   branches/                  fork branch pipes (per granularity: chunk / row / cell)
//   stroke.ts                  saga: stroke interpretation (symbol call + divert)
//   stroke.mutator.ts          Mutator: armStrokeState (strokeStart's entry) / strokeEnd
//   running.mutator.ts         Mutator: pause (a pure LoopState transition that calls no symbols;
//                              play graduated to a saga when its launch became a .spawn)
//   cache.ts                   pipe memoization (preserves the "self" of the divert)
//   wiringKeys.ts               wiring catalog key constants shared by divertsTo/describePipe
//   device.ts                  SimDevice catalog (mapping of port symbols to implementations, one-line delegates)
//
// Settings are an independent family (circuit/settings/ = Circuit.Settings).

export { simDevice } from './device';
