// tests/wiringCatalog.test.ts — CI verification of the wiring catalog (RAW layer).
//
// This test calls the raw `validateWiringGraph(doc)` directly = the RAW layer
// that knows nothing about command promotion. So all 6 entries appear
// literally: the tickLoop/stepOnce orphanEntry (2) + the play/pause/step/
// strokeEnd unlistedBoundSymbol (4, the bound portK members that get promoted
// to command endpoints). The expectations are derived from the RAW-layer
// allowlist `RAW_WIRING_ISSUE_ALLOWLIST` (scripts/wiringIssueAllowlist.ts). The
// ASSEMBLED layer that looks at the post-assembly unresolved
// (failOnWiringIssues in introspect.config.ts / introspectIndex.test.ts) is a
// separate list where the 4 promoted entries disappear, leaving 2
// (ASSEMBLED = RAW ∖ the 4 promoted). When a future pipe is added but its
// catalog registration is forgotten, or a divertsTo is typoed, it is detected
// as a new issue absent from this list.

import { projectWiringGraph, validateWiringGraph } from '@s-age/kernelee';
import { describe, expect, it } from 'vitest';
import { buildWiringCatalog, mergeWiringCatalog } from '../src/circuit/wiringCatalog';
import { makeKernel } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';
import { RAW_WIRING_ISSUE_ALLOWLIST } from '../scripts/wiringIssueAllowlist';

describe('buildWiringCatalog + validateWiringGraph', () => {
  it('no issue appears beyond RAW_WIRING_ISSUE_ALLOWLIST, and every listed issue actually appears', () => {
    const { boundSymbolIds, flowCatalog, guardCatalog } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) });
    const doc = projectWiringGraph(mergeWiringCatalog(flowCatalog), boundSymbolIds, guardCatalog);
    const issues = validateWiringGraph(doc);

    const allowedSet = new Set(RAW_WIRING_ISSUE_ALLOWLIST.map((e) => `${e.kind}:${e.key}`));
    const unallowed = issues.filter((issue) => !allowedSet.has(`${issue.kind}:${issue.key}`));
    expect(unallowed).toEqual([]); // an unknown issue = a detection target (forgotten new pipe, typo, a new granularity gap, ...)

    // Is the allowlist itself not hollow (still allowing issues that no longer occur)?
    const issueSet = new Set(issues.map((issue) => `${issue.kind}:${issue.key}`));
    for (const entry of RAW_WIRING_ISSUE_ALLOWLIST) {
      expect(issueSet.has(`${entry.kind}:${entry.key}`), `${entry.kind}: ${entry.key}`).toBe(true);
    }
  });

  it('flowCatalog entries deep-equal their hand-written describePipe twins — the merge substitution is invisible by construction', () => {
    // The hand entry must stay in buildWiringCatalog (the static scan
    // attributes per-endpoint facts by the source-visible describePipe calls,
    // in order), and the flow-derived entry must not drift from it: same key,
    // same pipe instance (hence deep-equal stages), same title/note. A failure
    // here means driver/wiring.ts's bindFlows and circuit/wiringCatalog.ts
    // describe the same pipe differently — fix the drift, never the merge.
    const { flowCatalog } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) });
    const handByKey = new Map(buildWiringCatalog().map((entry) => [entry.key, entry]));
    expect(flowCatalog.length).toBeGreaterThan(0); // the typed tier is actually in use
    for (const flowEntry of flowCatalog) {
      const handEntry = handByKey.get(flowEntry.key);
      expect(handEntry, `flow key '${flowEntry.key}' has no describePipe twin in buildWiringCatalog`).toBeDefined();
      expect(flowEntry, flowEntry.key).toEqual(handEntry);
    }
    // And the merged catalog therefore projects identically to the hand one —
    // same keys, same order (the order the static scan attributes by).
    expect(mergeWiringCatalog(flowCatalog).map((e) => e.key)).toEqual(
      buildWiringCatalog().map((e) => e.key),
    );
  });
});
