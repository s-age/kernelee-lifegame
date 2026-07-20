// circuit/settings/hydrateSettings.ts — settings hydrate saga.

import { pipeline, type Kernel } from '@s-age/kernelee';
import { SettingsStorePort } from '../../contract/ports';
import { loadedSettingsSwitch } from './loadedSettings.switch';
import { applyHydratedSettings } from './simState.mutator';

/**
 * `pipeline(load)` → null switch (Switch part: loadedSettings.switch.ts) →
 * reflect into SimState (once at startup, dispatched by app). A null from the
 * store (missing, corrupt, wrong shape) aborts and keeps the defaults —
 * settings never block startup. Speed goes through the same clamp on hydrate.
 */
export const hydratePipe = pipeline(SettingsStorePort.load)
  .pipe({ note: 'settings loaded?' }, loadedSettingsSwitch)
  .effect(applyHydratedSettings) // Mutator part (simState.mutator.ts): buffer write only
  .seal();

export function hydrateSettings(kernel: Kernel): Promise<void> {
  return kernel.run(hydratePipe);
}
