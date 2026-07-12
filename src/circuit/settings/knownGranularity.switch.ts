// circuit/settings/knownGranularity.switch.ts — Switch part.
//
// The principle for a Switch is "only translate the device's decision into a
// verb (next/abort)" (named after the **decision**, not the destination — this
// decision is "is the input granularity a known value?"). This gate combines
// gating (abort on unknown values) with payload assembly (attaching the known
// SimState.genPerSec for the next stage). The assembly is a buffer **read**
// plus repacking, not a write, so it is a weaker deviation than the Switch
// exception for "transitions inseparable from the decision", but the reason for
// the cohabitation is made explicit here: only the single stage shared with the
// unknown-value abort can express "only known values get a save payload"
// (splitting gate and assembly would leave the assembly as a stage with no verb
// branch of its own, and the stage sequence could no longer guarantee, by its
// shape, that assembly never runs after the gate aborts).
//
// Aborting on unknown values is the same defensive stance as clampSpeed
// (setSpeed.ts) — i.e. ignore. Per the topology classification (branching =
// *.switch.ts) the gate lives in its own file. Its decision and family are both
// distinct from circuit/sim/granularity.switch.ts (the self-divert Switch) —
// the file is named `knownGranularity` to avoid confusion.

import { abort, next, type Kernel } from '@s-age/kernelee';
import { SimState, type ForkGranularity } from '../../contract/states';

/** Unknown-value gate (abort = ignore) + save payload assembly. */
export function granularityGateAndPayload(kernel: Kernel, granularity: ForkGranularity) {
  return granularity === 'chunk' || granularity === 'row' || granularity === 'cell'
    ? next({ genPerSec: kernel.buffer.read(SimState).genPerSec, granularity })
    : abort(undefined);
}
