// circuit/wiringCatalog.ts — the single assembly point of the wiring catalog.
//
// Both main.tsx (the composition root, devtools bridge sender) and the CI
// verification tests import this — keeping the catalog array in two places
// independently would mean fixing both every time a new root pipe is added.

import { describePipe, type PipeDescriptorEntry } from '@s-age/kernelee';
import { SettingsPort, SimPort } from '../contract/ports';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from '../contract/states';
import { playPipe } from './sim/play';
import { randomizePipe } from './sim/randomize';
import { stepOncePipeFor } from './sim/stepOnce';
import { strokeMovePipe, strokeStartPipe } from './sim/stroke';
import { tickLoopPipeFor } from './sim/tickLoop';
import { togglePipe } from './sim/toggleCell';
import { CircuitSimKeys } from './sim/wiringKeys';
import { setGranularityPipe } from './settings/setGranularity';
import { setSpeedPipe } from './settings/setSpeed';
import { hydratePipe } from './settings/hydrateSettings';

/**
 * Covers all 10 of lifegame's root pipes (independent dispatch/kernel.run entry
 * points). Only the `tickLoop`/`stepOnce` keys go via `CircuitSimKeys` — they
 * are unbound pipes launched directly by divert/kernel.run, so no corresponding
 * `KernelSymbol` exists. The other 8 reference the `KernelSymbol.id` of the
 * actually-bound `SimPort`/`SettingsPort` directly (no new hand-typed
 * constants — one more reference site never creates duplication). `play` is now
 * among them: since its launch became a `.spawn` untracked fork branch (play.ts),
 * it is a catalogued saga endpoint whose spawn edge to `tickLoop` is what
 * resolves that loop's former orphanEntry (see scripts/wiringIssueAllowlist.ts).
 *
 * Every entry stays a SOURCE-VISIBLE `describePipe(...)` call in this one
 * function — including toggleCell, which is also `flow()`-bound in
 * driver/wiring.ts and therefore also appears in `builder.flowCatalog`. That
 * duplication is deliberate, not an oversight: kernelee-mcp-tools' static
 * scan attributes every per-endpoint fact (flows/wireSite/readsState/…) BY
 * CATALOG ORDER against the `describePipe` calls it finds in this function's
 * own body, so a flow-bound pipe removed from here would silently lose its
 * static half from the index. `mergeWiringCatalog` below is where the two
 * sources meet without double-cataloguing.
 */
export function buildWiringCatalog(): readonly PipeDescriptorEntry[] {
  return [
    describePipe(
      CircuitSimKeys.tickLoop,
      'Generation loop (tickLoop)',
      tickLoopPipeFor('chunk', DEFAULT_WIDTH, DEFAULT_HEIGHT),
      'The generation loop body. gate → one generation → sleep → divert to the next lap. The target granularity is selected at runtime by granularity.switch.ts reading SimState.granularity (the locus of the value→branch causality). Never placed on dispatch; launched fire-and-forget via kernel.run.',
    ),
    describePipe(
      CircuitSimKeys.stepOnce,
      'Manual step (stepOnce)',
      stepOncePipeFor('chunk', DEFAULT_WIDTH, DEFAULT_HEIGHT),
      'Runs the same one generation as the loop body for a single lap, with no sleep/divert. Aborts at the entry gate unless LoopState.phase is idle (the invariant of never stepping while running).',
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
      'Interprets the drag start point. Arms the stroke state, gates outside-the-board, and diverts to toggleCell.',
    ),
    describePipe(
      SimPort.strokeMove.id,
      'Stroke move (strokeMove)',
      strokeMovePipe,
      'Interprets drag-continuation moves. Gates outside-a-stroke (hover) and same-cell repeats, then diverts to toggleCell.',
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
