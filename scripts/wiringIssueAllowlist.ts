// scripts/wiringIssueAllowlist.ts — allowlist of known issues reported by validateWiringGraph.
//
// kernelee's validateWiringGraph (core) "only reports everything" — which
// issues are deliberate and harmless is this app's (the consumer's) judgment
// ("detection = tool side, judgment = app side").
//
// ★ Kept as 2 layers (the facts change across the layer boundary). Their
// relation is
//   ASSEMBLED = RAW ∖ COMMAND_PROMOTED
// and the difference is "the entries that kernelee-mcp-tools'
// scanCommandEndpoints promotes to command endpoints, which disappear from the
// post-assembly unresolved". ASSEMBLED is derived from RAW (no hand-typed
// double bookkeeping), so forgetting to add a promoted entry to
// COMMAND_PROMOTED after adding it to RAW surfaces as a visible mismatch —
// it is hard to update only one side and drift.
//
//   - RAW layer (`tests/wiringCatalog.test.ts`): calls the raw
//     `validateWiringGraph(doc)` directly. It knows nothing about command
//     promotion, so all entries literally appear.
//   - ASSEMBLED layer (`failOnWiringIssues` in `scripts/introspect.config.ts` +
//     `tests/introspectIndex.test.ts`): looks at the `IndexDocument.unresolved`
//     assembled by `runIntrospect`. The promoted entries are already
//     suppressed by assembleIndex, so they must **not** go into this allowlist
//     — if they did, then when the promotion regresses in the future and those
//     entries reappear, this allowlist would silently absorb them and CI would
//     not hard-error, disarming the "driveSite reversal" tripwire. Being a
//     derivation (RAW ∖ COMMAND_PROMOTED), they structurally cannot get in.
import type { WiringIssueAllowlistEntry } from '@s-age/kernelee-mcp-tools';

/**
 * The 3 entries that scanCommandEndpoints promotes to command endpoints, which
 * disappear from the post-assembly unresolved. They appear as
 * unlistedBoundSymbol in the raw validateWiringGraph, but assembleIndex
 * suppresses them in exchange for the promotion. This is the only difference
 * between RAW and ASSEMBLED, and the single explanation of "why the two layers
 * have different counts". pause/strokeEnd/clearError are bound portK members
 * with no corresponding describePipe (the Mutator in running.mutator.ts / the
 * strokeEnd Mutator / the clearError Mutator in
 * circuit/faults/kernelError.mutator.ts).
 *
 * `play` and `step` are NO LONGER here: since play's launch became a `.spawn`
 * untracked fork branch (play.ts) and step's launch became an in-pipe
 * `divert` (step.ts), both graduated to catalogued saga endpoints (each with
 * its own describePipe entry), so both are first-class `'endpoint'`s, not
 * unlisted-bound commands.
 */
const COMMAND_PROMOTED_UNLISTED: readonly WiringIssueAllowlistEntry[] = [
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Sim.pause' },
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Sim.strokeEnd' },
  { kind: 'unlistedBoundSymbol', key: 'Circuit.Faults.clearError' },
];

/**
 * RAW layer — accepts all entries the raw validateWiringGraph(doc) returns.
 * For `tests/wiringCatalog.test.ts` only.
 */
export const RAW_WIRING_ISSUE_ALLOWLIST: readonly WiringIssueAllowlistEntry[] = [
  // tickLoop is NOT an orphan: `play` launches it through a `.spawn`
  // untracked fork branch whose launcher declares `divertsTo: [tickLoop]`,
  // giving tickLoop an EXTERNAL referrer (`Circuit.Sim.play`) — a real
  // declared edge.
  //
  // stepOnce (and its former orphan-resolution story) no longer exists: the
  // one-lap generation body it used to name is now `advanceGenerationPipe`
  // (circuit/sim/advanceGeneration.ts), bound directly to its own port
  // symbol (`Circuit.Sim.advanceGeneration`) and catalogued under that same
  // id — like `play`/`randomize`/`toggleCell`, an endpoint whose OWN bound
  // symbol id is its catalog key needs no external referrer to avoid being
  // an orphan. `step` no longer diverts into a separate pipe at all: its one
  // stage IS the `Circuit.Sim.advanceGeneration` symbol
  // (`pipeline(symbol)`, step.ts) — a symbol-composition edge, not a divert,
  // so there is no `divertsTo` entry (and no orphan question) to resolve for
  // it any more.
  //
  // The 3 entries that disappear post-assembly via promotion (they do appear in the raw layer).
  ...COMMAND_PROMOTED_UNLISTED,
];

/**
 * ASSEMBLED layer — accepts the 0 entries (of the wiring-graph vocabulary)
 * that the IndexDocument.unresolved assembled by runIntrospect actually
 * contains for this repo's topology (KernelErrorState's stateDeclaration and
 * namedMutationVia's soft-null are separate, non-wiring-graph unresolved kinds
 * — see tests/introspectIndex.test.ts). Used by failOnWiringIssues in
 * `introspect.config.ts` and by `tests/introspectIndex.test.ts`. **Derived**
 * from RAW by subtracting COMMAND_PROMOTED (never hand-typed) — structurally
 * prevents the accident of keeping promoted entries allowed and disarming the
 * tripwire.
 */
export const ASSEMBLED_WIRING_ISSUE_ALLOWLIST: readonly WiringIssueAllowlistEntry[] =
  RAW_WIRING_ISSUE_ALLOWLIST.filter(
    (entry) => !COMMAND_PROMOTED_UNLISTED.some((p) => p.kind === entry.kind && p.key === entry.key),
  );
