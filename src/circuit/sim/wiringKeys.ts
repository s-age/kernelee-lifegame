// circuit/sim/wiringKeys.ts — wiring catalog keys. Shared constants so that
// tickLoop.ts's self-divertsTo and the describePipe call in
// circuit/wiringCatalog.ts do not hand-type the same string literal
// independently in separate files (a side measure against divertsTo's reliance
// on string equality). Typos and missed renames are caught by TS's
// "property does not exist" error, but grabbing a different key that also
// exists (a swapped key) still goes undetected — the same limit as
// validateWiringGraph.

export const CircuitSimKeys = {
  tickLoop: 'Circuit.Sim.tickLoop',
  stepOnce: 'Circuit.Sim.stepOnce',
} as const;
