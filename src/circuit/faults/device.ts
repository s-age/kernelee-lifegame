// circuit/faults/device.ts — FaultsDevice (mapping of port symbols to implementations).
// Same convention as sim/device.ts and settings/device.ts: a pure zero-logic catalog (one-line delegates).

import { type FaultsDevice } from '../../contract/ports';
import { clearError } from './kernelError.mutator';

export const faultsDevice: FaultsDevice = {
  clearError,
};
