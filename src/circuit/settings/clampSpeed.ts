// circuit/settings/clampSpeed.ts — range rule for genPerSec.
// The same rule applies to UI input and to values from the saved file (rules are
// owned by circuit — the store (Infrastructure) only guards shape (types)).

/** Clamp to a positive finite value in [0.1, 1000]. Non-finite falls back to the default 10. */
export function clampSpeed(genPerSec: number): number {
  return Number.isFinite(genPerSec) ? Math.min(Math.max(genPerSec, 0.1), 1000) : 10;
}
