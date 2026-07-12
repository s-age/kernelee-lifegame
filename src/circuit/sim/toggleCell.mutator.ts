// circuit/sim/toggleCell.mutator.ts — Mutator part.
//
// The tail `.effect` of togglePipe (toggleCell.ts) — merely writing the
// diffStats result to StatsState — lives here as the bare identifier passed to
// `.effect(applyToggleStats)`. The GridState write (the opening stage of
// togglePipe, performed atomically inside the same mutate callback that
// computes the toggle target index) does **not** come here — as toggleCell.ts's
// own doc comment declares, it is the exception where computation and write are
// inseparable (covered by the CI-floor allowlist).

import type { Kernel } from '@s-age/kernelee';
import { StatsState, type Stats } from '../../contract/states';

/** Reflect the diffStats result into StatsState as-is. */
export function applyToggleStats(kernel: Kernel, stats: Stats): void {
  kernel.buffer.mutate(StatsState, () => stats);
}
