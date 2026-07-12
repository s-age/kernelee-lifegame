// circuit/settings/setGranularity.ts — fork granularity change saga.

import { pipeline, type Kernel } from '@s-age/kernelee';
import { SettingsStorePort } from '../../contract/ports';
import { type ForkGranularity } from '../../contract/states';
import { granularityGateAndPayload } from './knownGranularity.switch';
import { applyGranularity } from './simState.mutator';

/**
 * Unknown-value gate (abort = ignore — the same defensive stance as clampSpeed)
 * → `.tap(save)` (**disk first**) → `.effect(mutate)`. The change takes effect
 * from the tick loop's next lap (the loop picks its divert target every lap).
 */
export const setGranularityPipe = pipeline(
  { note: 'Unknown-value gate (abort = ignore) + save payload assembly' },
  granularityGateAndPayload,
)
  .tap(SettingsStorePort.save)
  .effect(applyGranularity) // Mutator part (simState.mutator.ts): buffer write only
  .seal();

export function setGranularity(kernel: Kernel, granularity: ForkGranularity): Promise<void> {
  return kernel.run(setGranularityPipe, granularity);
}
