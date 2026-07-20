// circuit/faults — faults family (Circuit.Faults). The public surface is faultsDevice only (wiring lives in driver).
//
// family = 1:1 with the port namespace (circuit/<family>/ = Circuit.<Family>.*).
// Isolated from sim/settings: clearing the error banner acts on the
// framework-owned KernelErrorState cell, not on this app's own board/settings
// domain, so it does not belong in either existing family.
//
//   kernelError.mutator.ts   Mutator: clearError, KernelErrorState's clear-side write (no symbol calls)
//   device.ts                FaultsDevice catalog (one-line delegate)

export { faultsDevice } from './device';
