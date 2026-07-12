// circuit/sim — tick loop (saga). The public surface is simDevice only (wiring lives in driver).
//
// Follows the saga / Switch / Emitter taxonomy.
// The `+` of part files becomes a dot-suffix in TS (*.switch.ts / *.emitter.ts).
//
//   tickLoop.ts                saga: divert generation loop (the launch rule launchTickLoop lives in
//                              running.mutator.ts)
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
//   running.mutator.ts         Mutator: play / pause / launchTickLoop (pure buffer transitions
//                              that call no symbols + fire-and-forget launch)
//   cache.ts                   pipe memoization (preserves the "self" of the divert)
//   wiringKeys.ts               wiring catalog key constants shared by divertsTo/describePipe
//   device.ts                  SimDevice catalog (mapping of port symbols to implementations, one-line delegates)
//
// Settings are an independent family (circuit/settings/ = Circuit.Settings).

export { simDevice } from './device';
