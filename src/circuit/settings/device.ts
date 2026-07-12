// circuit/settings/device.ts — SettingsDevice (mapping of port symbols to implementations).
// Same convention as sim/device.ts: a pure zero-logic catalog (one-line delegates).

import { type SettingsDevice } from '../../contract/ports';
import { hydrateSettings } from './hydrateSettings';
import { setGranularity } from './setGranularity';
import { setSpeed } from './setSpeed';

export const settingsDevice: SettingsDevice = {
  setSpeed,
  setGranularity,
  hydrateSettings,
};
