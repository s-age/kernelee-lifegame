// scripts/wiringIssueAllowlist.ts — allowlist of known issues reported by validateWiringGraph.
//
// kernelee's validateWiringGraph (core) "only reports everything" — which
// issues are deliberate and harmless is this app's (the consumer's) judgment
// ("detection = tool side, judgment = app side").
//
// ★ Kept as 2 layers (the facts change across the layer boundary). Their
// relation is
//   ASSEMBLED = RAW ∖ COMMAND_PROMOTED
// and the difference is "the 4 entries that kernelee-mcp-tools'
// scanCommandEndpoints promotes to command endpoints, which disappear from the
// post-assembly unresolved". ASSEMBLED is derived from RAW (no hand-typed
// double bookkeeping), so forgetting to add a promoted entry to
// COMMAND_PROMOTED after adding it to RAW surfaces as a visible mismatch —
// it is hard to update only one side and drift.
//
//   - RAW layer (`tests/wiringCatalog.test.ts`): calls the raw
//     `validateWiringGraph(doc)` directly. It knows nothing about command
//     promotion, so all 6 entries literally appear.
//   - ASSEMBLED layer (`failOnWiringIssues` in `scripts/introspect.config.ts` +
//     `tests/introspectIndex.test.ts`): looks at the `IndexDocument.unresolved`
//     assembled by `runIntrospect`. The 4 promoted entries are already
//     suppressed by assembleIndex, so they must **not** go into this allowlist
//     — if they did, then when the promotion regresses in the future and the 4
//     entries reappear, this allowlist would silently absorb them and CI would
//     not hard-error, disarming the "driveSite 4→0 reversal" tripwire. Being a
//     derivation (RAW ∖ COMMAND_PROMOTED), they structurally cannot get in.
import type { WiringIssueAllowlistEntry } from '@s-age/kernelee-mcp-tools';
import { CircuitSimKeys } from '../src/circuit/sim/wiringKeys';

/**
 * The 3 entries that scanCommandEndpoints promotes to command endpoints, which
 * disappear from the post-assembly unresolved. They appear as
 * unlistedBoundSymbol in the raw validateWiringGraph, but assembleIndex
 * suppresses them in exchange for the promotion. This is the only difference
 * between RAW and ASSEMBLED, and the single explanation of "why the two layers
 * have different counts". pause/step/strokeEnd are bound portK members with no
 * corresponding describePipe (the Mutator in running.mutator.ts / the one-line
 * launcher in stepOnce.ts / the strokeEnd Mutator).
 *
 * `play` is NO LONGER here: since its launch became a `.spawn` untracked fork
 * branch it graduated to a catalogued saga endpoint (play.ts + a describePipe
 * entry), so it is a first-class `'endpoint'`, not an unlisted-bound command.
 */
const COMMAND_PROMOTED_UNLISTED: readonly WiringIssueAllowlistEntry[] = [
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Sim.pause' },
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Sim.step' },
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Sim.strokeEnd' },
];

/**
 * RAW layer — accepts all 6 entries the raw validateWiringGraph(doc) returns.
 * For `tests/wiringCatalog.test.ts` only.
 */
export const RAW_WIRING_ISSUE_ALLOWLIST: readonly WiringIssueAllowlistEntry[] = [
  // stepOnce stays orphanEntry permanently — the HONEST CLASSIFICATION of a
  // launch-only divertTarget, not a hole. It is launched directly via
  // `kernel.run` (step's own one-line delegate awaits it), with no external
  // `divertsTo` referrer anywhere, so it has no incoming edge but its launch.
  //
  // tickLoop is NO LONGER an orphan: `play` now launches it through a `.spawn`
  // untracked fork branch whose launcher declares `divertsTo: [tickLoop]`, so
  // the fold gives tickLoop an EXTERNAL referrer (`Circuit.Sim.play`) — a real
  // declared edge, not a self-loop. The orphan is resolved honestly (the check
  // is unchanged; the topology genuinely gained an edge), so tickLoop is
  // removed from this allowlist. (Its self-divert edge from granularity.switch
  // still exists; the orphan check excludes self-referrers, which is why the
  // NEW external `play` edge is what flips it.)
  { kind: 'orphanEntry', key: CircuitSimKeys.stepOnce },
  // The 3 entries that disappear post-assembly via promotion (they do appear in the raw layer).
  ...COMMAND_PROMOTED_UNLISTED,
];

/**
 * ASSEMBLED layer — accepts the 2 entries (orphanEntry×2) that the
 * IndexDocument.unresolved assembled by runIntrospect actually contains.
 * Used by failOnWiringIssues in `introspect.config.ts` and by
 * `tests/introspectIndex.test.ts`. **Derived** from RAW by subtracting
 * COMMAND_PROMOTED (never hand-typed) — structurally prevents the accident of
 * keeping promoted entries allowed and disarming the tripwire.
 */
export const ASSEMBLED_WIRING_ISSUE_ALLOWLIST: readonly WiringIssueAllowlistEntry[] =
  RAW_WIRING_ISSUE_ALLOWLIST.filter(
    (entry) => !COMMAND_PROMOTED_UNLISTED.some((p) => p.kind === entry.kind && p.key === entry.key),
  );
