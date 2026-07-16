// circuit/settings/setGranularity.ts — fork granularity change saga.
//
// The unknown-value veto now runs as a framework GATE (`guard:settings.
// knownGranularity`, guarding `Circuit.Settings.setGranularity` —
// circuit/settings/knownGranularity.gate.ts, bound in driver/wiring.ts's
// `bindGuards`) BEFORE this pipe is ever reached. Since a gate's `next(v)`
// value is discarded (declareGate's own doc comment), the save-payload
// assembly can no longer live in the gate — it is this pipe's own new entry
// stage below, run UNCONDITIONALLY: safe because the gate already filtered
// unknown values before this pipe started.

import { next, pipeline, type Kernel } from '@s-age/kernelee';
import { SettingsStorePort } from '../../contract/ports';
import { SimState, type ForkGranularity } from '../../contract/states';
import { applyGranularity } from './simState.mutator';

/**
 * Assemble the save payload (unconditional — the guarding gate already
 * filtered unknown values) → `.tap(save)` (**disk first**) → `.effect(mutate)`.
 * The change takes effect from the tick loop's next lap (the loop picks its
 * divert target every lap).
 */
export const setGranularityPipe = pipeline(
  { note: 'Assemble the save payload (genPerSec read + granularity) — the unknown-value gate already ran as the guarding gate (guard:settings.knownGranularity)' },
  (kernel: Kernel, granularity: ForkGranularity) =>
    next({ genPerSec: kernel.buffer.read(SimState).genPerSec, granularity }),
)
  .tap(SettingsStorePort.save)
  .effect(applyGranularity) // Mutator part (simState.mutator.ts): buffer write only
  .seal();

export function setGranularity(kernel: Kernel, granularity: ForkGranularity): Promise<void> {
  return kernel.run(setGranularityPipe, granularity);
}
