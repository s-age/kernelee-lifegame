// circuit/wiringCatalog.ts — the single assembly point of the wiring catalog.
//
// Both main.tsx (the composition root, devtools bridge sender) and the CI
// verification tests import this — keeping the catalog array in two places
// independently would mean fixing both every time a new root pipe is added.

import { describePipe, type PipeDescriptorEntry } from '@s-age/kernelee';
import { SettingsPort, SimFlowKeys, SimPort } from '../contract/ports';
import { advanceGenerationPipe } from './sim/advanceGeneration';
import { playPipe } from './sim/play';
import { randomizePipe } from './sim/randomize';
import { stepPipe } from './sim/step';
import { strokeMovePipe, strokeStartPipe } from './sim/stroke';
import { tickLoopPipe } from './sim/tickLoop';
import { togglePipe } from './sim/toggleCell';
import { setGranularityPipe } from './settings/setGranularity';
import { setSpeedPipe } from './settings/setSpeed';
import { hydratePipe } from './settings/hydrateSettings';

/**
 * Covers all 11 of lifegame's root pipes (independent dispatch/kernel.run entry
 * points). `tickLoop` is keyed via `SimFlowKeys.tickLoop.key` — like
 * `toggleCell` and `strokeMove`, it is ALSO `flow()`-bound in
 * driver/wiring.ts (see this file's own duplication note below), unlike the
 * other 8 which have no divert-side binding at all and reference the
 * `KernelSymbol.id` of the actually-bound `SimPort`/`SettingsPort` directly.
 * `play` and `step` are both among the 8: since play's launch became a
 * `.spawn` untracked fork branch (play.ts), it is a catalogued saga endpoint
 * whose spawn edge to `tickLoop` resolves that loop's former orphanEntry (see
 * scripts/wiringIssueAllowlist.ts). `step` composes the shared generation
 * sequence as the `Circuit.Sim.advanceGeneration` symbol
 * (`pipeline(symbol)`, step.ts) rather than diverting into a separate
 * one-lap pipe — `advanceGeneration` is its own catalogued endpoint below,
 * reached by BOTH `step` (symbol-entry) and `tickLoop` (`.tap`, mid-pipe) as
 * symbol-composition edges, never divert edges.
 *
 * Every entry stays a SOURCE-VISIBLE `describePipe(...)` call in this one
 * function — including toggleCell/tickLoop/strokeMove, which are also
 * `flow()`-bound in driver/wiring.ts and therefore also appear in
 * `builder.flowCatalog`. That duplication is deliberate, not an oversight:
 * kernelee-mcp-tools' static scan attributes every per-endpoint fact
 * (flows/wireSite/readsState/…) BY CATALOG ORDER against the `describePipe`
 * calls it finds in this function's own body, so a flow-bound pipe removed
 * from here would silently lose its static half from the index.
 * `mergeWiringCatalog` below is where the two sources meet without
 * double-cataloguing.
 */
export function buildWiringCatalog(): readonly PipeDescriptorEntry[] {
  return [
    describePipe(
      SimFlowKeys.tickLoop.key,
      'Generation loop (tickLoop)',
      tickLoopPipe,
      'The generation loop body. switch → one generation (Circuit.Sim.advanceGeneration, composed via .tap — a symbol-composition edge, not a divert) → sleep → divert back into this same pipe (self-divert reentry). Also the divert target of play\'s detached .spawn launcher.',
    ),
    describePipe(
      SimPort.advanceGeneration.id,
      'Advance one generation (advanceGeneration)',
      advanceGenerationPipe,
      'Advances the board exactly one generation: snapshot → Compute.Life.partitionRanges (reads SimState.granularity) → fork(symbol) over Compute.Life.stepIndexRange (runtime-sized) → Emitter join → fork (board line / Compute.Life.diffStats line) → pair-emits GridState + StatsState. A predefined process composed by tickLoop (.tap, mid-pipe) and step (pipeline(symbol), its whole pipe) as symbol-composition edges — not a command intended for dispatch, and never itself gated (see the file\'s own doc comment on verb containment).',
    ),
    describePipe(
      SimPort.step.id,
      'Manual step (step)',
      stepPipe,
      'A single-stage pipe that IS the Circuit.Sim.advanceGeneration symbol (pipeline(symbol) — a symbol-composition edge, not a divert). Aborts at the entry gate unless LoopState.phase is idle (guard:loop.idle). Unlike play\'s detached .spawn, this stays on-bus and is `kernel.run`-awaited, so rapid Step clicks serialize instead of racing.',
    ),
    describePipe(
      SimPort.play.id,
      'Play (play)',
      playPipe,
      'Arms the loop phase (double-start guard) then launches the generation loop as a detached .spawn untracked fork branch — the visible edge to tickLoop. A branch fault routes to the framework errorSink (onError policy resets LoopState to idle).',
    ),
    describePipe(
      SimPort.randomize.id,
      'Randomize (randomize)',
      randomizePipe,
      'Generates a random board, pair-emits GridState and StatsState via the fork (board line/stats line), and resets the generation to 0.',
    ),
    describePipe(
      SimPort.toggleCell.id,
      'Cell toggle (toggleCell)',
      togglePipe,
      'Toggles a single cell copy-on-write and pair-emits the transition stats. Also the divert target of the stroke saga.',
    ),
    describePipe(
      SimPort.strokeStart.id,
      'Stroke start (strokeStart)',
      strokeStartPipe,
      'Arms the stroke state, then diverts to Circuit.Sim.strokeMove — the start point is interpreted as the first move (hitCell resolution, off-board/same-cell filtering, and the toggleCell hop all live there).',
    ),
    describePipe(
      SimPort.strokeMove.id,
      'Stroke move (strokeMove)',
      strokeMovePipe,
      'Interprets drag-continuation moves. Filters outside-a-stroke (hover, via guard:stroke.active) and same-cell repeats, then diverts to toggleCell. Also the divert target of strokeStart — the start point is interpreted as the first move.',
    ),
    describePipe(
      SettingsPort.setSpeed.id,
      'Speed setting (setSpeed)',
      setSpeedPipe,
      'Clamps genPerSec, disk first (tap save) → reflect into SimState. If the save fails the state is not updated.',
    ),
    describePipe(
      SettingsPort.setGranularity.id,
      'Granularity setting (setGranularity)',
      setGranularityPipe,
      'Gates unknown fork granularity values, disk first → reflect into SimState. Takes effect from the tick loop\'s next lap.',
    ),
    describePipe(
      SettingsPort.hydrateSettings.id,
      'Settings hydrate (hydrateSettings)',
      hydratePipe,
      'Loads settings from the store once at startup. Missing/corrupt data aborts, keeping the defaults (settings never block startup).',
    ),
  ];
}

/**
 * Fold `KernelBuilder.flowCatalog` (the catalog kernelee derives from the
 * `builder.flow(...)` binding table — see driver/wiring.ts's `bindFlows`) into
 * the hand-built catalog above, deduped by key: for a key present in both,
 * the flow-derived entry wins (it is the one a binding structurally
 * guarantees — the direction of truth kernelee's `flow()` establishes), while
 * the hand entry keeps that key's POSITION. Order preservation is
 * load-bearing, not cosmetic: kernelee-mcp-tools attributes per-endpoint
 * static facts by catalog order against `buildWiringCatalog`'s source, so the
 * merged catalog must present the same keys in the same order as the source
 * `describePipe` calls (a flow entry with no hand twin would land at the tail
 * and trip the assembly's count-mismatch guard — loudly, by design).
 *
 * In practice the substitution is invisible: `bindFlows` passes the same pipe
 * instance and the same title/note as the hand entry, so the two entries are
 * deep-equal (tests/wiringCatalog.test.ts pins this). The merge still exists —
 * with it, the projected catalog's flow-bound entries are DERIVED from the
 * binding table rather than transcribed by hand, so a future drift between
 * `flow()` and `describePipe` shows up as a changed projection + a failed
 * equality test instead of silently shipping the transcription.
 */
export function mergeWiringCatalog(
  flowCatalog: readonly PipeDescriptorEntry[],
): readonly PipeDescriptorEntry[] {
  const flowByKey = new Map(flowCatalog.map((entry) => [entry.key, entry]));
  const hand = buildWiringCatalog();
  const handKeys = new Set(hand.map((entry) => entry.key));
  return [
    ...hand.map((entry) => flowByKey.get(entry.key) ?? entry),
    ...flowCatalog.filter((entry) => !handKeys.has(entry.key)),
  ];
}
