// scripts/offBufferControlValueAllowlist.ts — allowlist of module-level control
// values that scanOffBufferControlValues reports as "deliberately outside the
// Buffer".
//
// kernelee-mcp-tools' scanOffBufferControlValues (a core-independent static
// scan) "only reports everything" — which values are deliberate and harmless is
// this app's (the consumer's) judgment (the same "detection = tool side,
// judgment = app side" discipline as wiringIssueAllowlist.ts). It is a separate
// gate from wiringIssueAllowlist (failOnOffBufferControlValues /
// offBufferControlValueAllowlist) — offBufferControlValue comes from the static
// scan, not from validateWiringGraph, so it is never mixed into the allowlist
// for WIRING_GRAPH_ISSUE_KINDS.
//
// This list is empty — the machine-readable statement of "the Buffer is the
// home of everything causal" (failOnOffBufferControlValues passes with an empty
// allowlist): every value with causality (stroke interpretation state, loop
// liveness) lives in Buffer states (StrokeState / LoopState), never in
// module-level WeakMap/WeakSet keyed by kernel.
//
// When adding a new entry, never justify it with "the UI does not observe it"
// alone — state in `reason` whether it is 'memo' (a cache that can be discarded
// without changing behavior) or 'ambient' (external causality like Date.now()/
// setTimeout that cannot live in a Buffer).
import type { OffBufferControlValueAllowlistEntry } from '@s-age/kernelee-mcp-tools';

export const OFF_BUFFER_CONTROL_VALUE_ALLOWLIST: readonly OffBufferControlValueAllowlistEntry[] = [];
