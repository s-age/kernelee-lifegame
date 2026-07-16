// circuit/settings/knownGranularity.gate.ts — Gate part (framework interceptor/gate, not a Switch).
//
// The decision is "is the input granularity a known value?" — named after the
// decision, not the destination. Migrated from a pipe-entry Switch to a
// framework `declareGate`/`KernelBuilder.guard` pre-handler veto, guarding
// `Circuit.Settings.setGranularity`.
//
// This migration RESOLVES the cohabitation tension the old Switch's own doc
// comment argued about: a gate's `next(v)` value is DISCARDED in v1 (see
// `declareGate`'s own doc comment), so the payload assembly half — attaching
// `SimState.genPerSec` to build the save payload — structurally CANNOT live
// here anymore; there is no channel from a gate back into the guarded
// handler's payload. The split is now a real separation, not a shared stage:
// this file keeps ONLY the known-3-values check (`abort(undefined)` on
// unknown, payload untouched), and `setGranularityPipe`'s own new entry stage
// (circuit/settings/setGranularity.ts) does the buffer read + `{genPerSec,
// granularity}` assembly UNCONDITIONALLY — safe precisely because this gate
// filters unknown values before the pipe ever starts.
//
// Aborting on unknown values is the same defensive stance as clampSpeed
// (setSpeed.ts) — i.e. ignore.
//
// **No longer a part file** — invisible to `*.switch.ts`'s stage-link
// topology (see circuit/sim/launchArm.gate.ts's own doc comment for the
// general reasoning). `.gate.ts` is deliberate and non-part. Its decision and
// family are both distinct from circuit/sim/granularity.switch.ts (the
// self-divert Switch, unrelated and still a real part file) — the file stays
// named `knownGranularity` to avoid confusion.
//
// `abort(undefined)` here is the approved O=void bus-entry ignore contract:
// `Circuit.Settings.setGranularity` is a `portK<ForkGranularity, void>`
// command whose own description already promises "unknown values are
// ignored". `abort` from a gate always terminates the ENCLOSING flow; safe
// only because `setGranularity` is never composed mid-pipe by another saga.
//
// Passed as a bare identifier to `declareGate('guard:settings.knownGranularity',
// knownGranularityGate)` (a named handler with an address in the index's
// GateEntry.handler).

import { abort, declareGate, next, type Kernel } from '@s-age/kernelee';
import { type ForkGranularity } from '../../contract/states';

/** Unknown-value gate (abort = ignore). Payload untouched — see file header. */
export function knownGranularityGate(_kernel: Kernel, granularity: ForkGranularity) {
  return granularity === 'chunk' || granularity === 'row' || granularity === 'cell' ? next() : abort(undefined);
}

/** Guards `Circuit.Settings.setGranularity` — bound in driver/wiring.ts's `bindGuards`. */
export const knownGranularityGateRef = declareGate<ForkGranularity>(
  'guard:settings.knownGranularity',
  knownGranularityGate,
);
