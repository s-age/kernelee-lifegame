// compute/device.ts — LifePort device (conforms to CallableDevice).
// Wiring (registration into the builder) is driver's responsibility — this file
// only bundles and exports the implementations.
// Only port (leaf, value-returning) entries, so no runtime import of kernelee
// is needed (the device type comes in via contract).

import type { LifeDevice } from '../contract/ports';
import { diffStats, hitCell, partitionRanges, randomize, stepIndexRange } from './life';

export const lifeDevice: LifeDevice = {
  stepIndexRange,
  partitionRanges,
  randomize,
  hitCell,
  diffStats,
};
