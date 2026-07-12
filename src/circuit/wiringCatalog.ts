// circuit/wiringCatalog.ts — the single assembly point of the wiring catalog.
//
// Both main.tsx (the composition root, devtools bridge sender) and the CI
// verification tests import this — keeping the catalog array in two places
// independently would mean fixing both every time a new root pipe is added.

import { describePipe, type PipeDescriptorEntry } from '@s-age/kernelee';
import { SettingsPort, SimPort } from '../contract/ports';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from '../contract/states';
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
 * Covers all 9 of lifegame's root pipes (independent dispatch/kernel.run entry
 * points). Only the `tickLoop`/`stepOnce` keys go via `CircuitSimKeys` — they
 * are unbound pipes launched directly by `kernel.run`, so no corresponding
 * `KernelSymbol` exists. The other 7 reference the `KernelSymbol.id` of the
 * actually-bound `SimPort`/`SettingsPort` directly (no new hand-typed
 * constants — one more reference site never creates duplication).
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
