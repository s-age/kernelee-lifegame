// circuit/settings/simState.mutator.ts — Mutator part.
//
// Collects the three pipe-tail `.effect`s whose sole purpose is reflecting into
// SimState (transition axis = SimState, the same style as running.mutator.ts
// collecting play/pause on the LoopState.phase axis). All three sit **after**
// the disk-first `.tap(save)`, call no symbols, and only write SimState — hence
// they are bare identifiers.

import type { Kernel } from '@s-age/kernelee';
import type { SimSettings } from '../../contract/ports';
import { SimState } from '../../contract/states';
import { clampSpeed } from './clampSpeed';

// All three return the current reference when the value is unchanged — never
// make subscribers' change detection fire spuriously with a fresh reference for
// a no-op write (copy-on-write means "new reference when the value changed",
// not "new reference on every write"). Same-value reflection really happens:
// repeated setSpeed with the same clamped value, a startup hydrate reading a
// saved value equal to the default, and so on.

/** Reflect the saved genPerSec into SimState. */
export function applySpeed(kernel: Kernel, settings: SimSettings): void {
  kernel.buffer.mutate(SimState, (sim) =>
    sim.genPerSec === settings.genPerSec ? sim : { ...sim, genPerSec: settings.genPerSec },
  );
}

/** Reflect the saved granularity into SimState. */
export function applyGranularity(kernel: Kernel, settings: SimSettings): void {
  kernel.buffer.mutate(SimState, (sim) =>
    sim.granularity === settings.granularity ? sim : { ...sim, granularity: settings.granularity },
  );
}

/** Reflect the settings read by hydrate (clamp included) into SimState. */
export function applyHydratedSettings(kernel: Kernel, settings: SimSettings): void {
  const genPerSec = clampSpeed(settings.genPerSec);
  kernel.buffer.mutate(SimState, (sim) =>
    sim.genPerSec === genPerSec && sim.granularity === settings.granularity
      ? sim
      : { ...sim, genPerSec, granularity: settings.granularity },
  );
}
