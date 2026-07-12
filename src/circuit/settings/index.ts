// circuit/settings — settings family (Circuit.Settings). The public surface is settingsDevice only (wiring lives in driver).
//
// family = 1:1 with the port namespace (circuit/<family>/ = Circuit.<Family>.*).
// Persistence discipline: **disk first, then reflect into the buffer** (.tap(save) → .effect(mutate)).
//
//   clampSpeed.ts             range rule (the same rule for UI input and saved values)
//   hydrateSettings.ts        saga: load → null gate → reflect into SimState (once at startup)
//   setSpeed.ts               saga: clamp → save → reflect
//   setGranularity.ts         saga: unknown-value gate → save → reflect
//   simState.mutator.ts       Mutator: the SimState-reflecting effects of the three sagas above (pure buffer transitions, no symbol calls)
//   device.ts                 SettingsDevice catalog (one-line delegates)

export { settingsDevice } from './device';
