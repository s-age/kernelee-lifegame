// circuit/settings/setSpeed.ts — speed change saga.

import { next, pipeline, type Kernel } from '@s-age/kernelee';
import { SettingsStorePort } from '../../contract/ports';
import { SimState } from '../../contract/states';
import { clampSpeed } from './clampSpeed';
import { applySpeed } from './simState.mutator';

/**
 * Clamp → `.tap(save)` (**disk first**) → `.effect(mutate)`.
 * A failing tap stops the pipe, so if the write fails SimState never claims a
 * value that is not on disk — the discipline shows up in the descriptors as
 * stage order.
 */
export const setSpeedPipe = pipeline(
  { note: 'Clamp (range rules are owned by circuit) + save payload assembly' },
  (kernel: Kernel, genPerSec: number) =>
    next({
      genPerSec: clampSpeed(genPerSec),
      granularity: kernel.buffer.read(SimState).granularity,
    }),
)
  .tap(SettingsStorePort.save)
  .effect(applySpeed) // Mutator part (simState.mutator.ts): buffer write only
  .seal();

export function setSpeed(kernel: Kernel, genPerSec: number): Promise<void> {
  return kernel.run(setSpeedPipe, genPerSec);
}
