// tests/introspectIndex.test.ts — verification of the IndexDocument's schema
// completeness + static-scan exhaustiveness.
//
// wiringCatalog.test.ts verifies only the runtime layer (projectWiringGraph +
// validateWiringGraph). This file runs kernelee-mcp-tools' runIntrospect against
// the real catalog (the same configuration as scripts/introspect.config.ts) and
// verifies the assembled IndexDocument (the post-static-scan shape, including
// inputType/drivenBy/readsState/writesState/emittableVerbs/states/unresolved) —
// an exhaustiveness check that extends to "is anything that could not be
// recovered being silently dropped?".

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { IndexDocument, StageEntry } from '@s-age/kernelee-mcp-tools';
import { runIntrospect } from '@s-age/kernelee-mcp-tools';
import introspectConfig from '../scripts/introspect.config';
import { ASSEMBLED_WIRING_ISSUE_ALLOWLIST } from '../scripts/wiringIssueAllowlist';
import { OFF_BUFFER_CONTROL_VALUE_ALLOWLIST } from '../scripts/offBufferControlValueAllowlist';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');

/** Recursively enumerate `src/**\/*.switch.ts` and `src/**\/*.emitter.ts` (relative paths, posix separators). */
function partFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return partFiles(path);
    return /\.(switch|emitter)\.ts$/.test(entry.name) ? [relative(repoRoot, path).split('\\').join('/')] : [];
  });
}

function allStages(stages: readonly StageEntry[]): StageEntry[] {
  return stages.flatMap((stage) => [stage, ...stage.branches.flatMap(allStages)]);
}

/** The 4 `command`-kind endpoints — bound `portK` port members with no
 * `describePipe`d `Pipe` behind them, so `stages: []`/`inputType: null` are
 * honest for these specifically, not the "forgot to write it" case the
 * 9-catalog-pipe floor below polices. */
const COMMAND_KEYS = ['Circuit.Sim.play', 'Circuit.Sim.pause', 'Circuit.Sim.step', 'Circuit.Sim.strokeEnd'];

describe('runIntrospect against the real wiring catalog (index.json schema)', () => {
  let document: IndexDocument;
  let scratchDir: string;

  beforeAll(async () => {
    // Never overwrite the real .claude/introspect/index.json — write to a
    // scratch temp output.
    scratchDir = mkdtempSync(join(tmpdir(), 'kernelee-lifegame-introspect-test-'));
    document = await runIntrospect({ ...introspectConfig, outputPath: join(scratchDir, 'index.json') });
    return () => rmSync(scratchDir, { recursive: true, force: true });
  }, 15000); // full ts-morph scan — the default 10000ms is tight under load

  it('populates every required endpoint/stage/symbol field (no silent empty)', () => {
    // The 9 describePipe catalog entries + the 4 command endpoints
    // (play/pause/step/strokeEnd — first-class-tokenized drive sites).
    expect(document.endpoints).toHaveLength(13);
    for (const endpoint of document.endpoints) {
      const isCommand = endpoint.kind === 'command';
      expect(endpoint.key.length).toBeGreaterThan(0);
      expect(endpoint.title.length).toBeGreaterThan(0);
      // inputType: all 9 describePipe catalog entries are fully recovered by the
      // static scan (proof that the runtime-erasure gap is closed). Command
      // endpoints have no actual Pipe<I,O>, so inputType: null is the honest
      // value (not a miss).
      if (isCommand) {
        expect(endpoint.inputType, `${endpoint.key}: command endpoint must have inputType null (no Pipe)`).toBeNull();
      } else {
        expect(endpoint.inputType, `${endpoint.key}: inputType not recovered`).not.toBeNull();
      }
      // endpoint note = the headline of arch_overview/arch_endpoint. An "existence
      // floor" — an empty one makes the entry meaningless (content quality is the
      // implement-circuit rules' job; this only detects forgotten notes).
      // The absence of a floor on stage-notes is a deliberate asymmetry — floors
      // go where a hole actually opened (endpoint, once a 9/9-null incident).
      // Command endpoint notes come from the portK doc strings (the author text
      // already present in ports.ts).
      expect((endpoint.note ?? '').length, `${endpoint.key}: empty endpoint note`).toBeGreaterThan(0);
      // Command endpoints have no corresponding Pipe — stages: [] is the honest value.
      if (isCommand) expect(endpoint.stages).toEqual([]);
      for (const stage of allStages(endpoint.stages)) {
        expect(stage.kind.length, `${endpoint.key}: stage with empty kind`).toBeGreaterThan(0);
        if (stage.kind === 'fork(branches)') {
          expect(stage.branchArity, `${endpoint.key}: fork stage without branchArity`).not.toBeNull();
        }
      }
    }
    for (const symbol of document.symbols) {
      expect(symbol.id.length, 'empty symbol id').toBeGreaterThan(0);
      expect(symbol.ring.length, `${symbol.id}: empty ring`).toBeGreaterThan(0);
      expect(symbol.device.length, `${symbol.id}: empty device`).toBeGreaterThan(0);
    }
  });

  it('classifies endpoint vs divertTarget vs command by boundSymbolIds/describePipe/portK, matching the known catalog shape', () => {
    const byKey = new Map(document.endpoints.map((e) => [e.key, e]));
    // tickLoop/stepOnce are launched directly via kernel.run and never bound —
    // permanent divertTarget (the fact paired with the orphanEntry fixed list
    // in wiringCatalog.test.ts).
    expect(byKey.get('Circuit.Sim.tickLoop')?.kind).toBe('divertTarget');
    expect(byKey.get('Circuit.Sim.stepOnce')?.kind).toBe('divertTarget');
    for (const key of [
      'Circuit.Sim.randomize',
      'Circuit.Sim.toggleCell',
      'Circuit.Sim.strokeStart',
      'Circuit.Sim.strokeMove',
      'Circuit.Settings.setSpeed',
      'Circuit.Settings.setGranularity',
      'Circuit.Settings.hydrateSettings',
    ]) {
      expect(byKey.get(key)?.kind, key).toBe('endpoint');
    }
    // play/pause/step/strokeEnd: bound portK members with no describePipe entry —
    // a THIRD kind, neither 'endpoint' (needs a catalogued Pipe) nor 'divertTarget'.
    for (const key of COMMAND_KEYS) {
      expect(byKey.get(key)?.kind, key).toBe('command');
    }
  });

  it('tickLoop/stepOnce — the orphan-by-launch entries — carry a real drive→launch edge', () => {
    // Their OWN kind is divertTarget (still not bound directly — divert/
    // kernel.run launch is a different causal channel than dispatch), but each
    // carries a real, statically-recovered launch edge with mode 'run', so they
    // are not undrivable orphans from the graph's own perspective.
    for (const key of ['Circuit.Sim.tickLoop', 'Circuit.Sim.stepOnce']) {
      const endpoint = document.endpoints.find((e) => e.key === key)!;
      expect(endpoint.kind, key).toBe('divertTarget');
      expect(endpoint.drivenBy.length, key).toBeGreaterThan(0);
      expect(endpoint.drivenBy.every((d) => d.mode === 'run'), key).toBe(true);
    }
    // play launches tickLoop (through launchTickLoop, one helper hop); step
    // launches stepOnce directly (stepOnce.ts IS the command's own impl).
    const tickLoop = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;
    const stepOnce = document.endpoints.find((e) => e.key === 'Circuit.Sim.stepOnce')!;
    expect(tickLoop.drivenBy.some((d) => d.owner === 'launchTickLoop')).toBe(true);
    expect(stepOnce.drivenBy.some((d) => d.owner === 'stepOnce')).toBe(true);
  });

  it('every command endpoint (play/pause/step/strokeEnd) has a real drive site', () => {
    for (const key of COMMAND_KEYS) {
      const endpoint = document.endpoints.find((e) => e.key === key)!;
      expect(endpoint.drivenBy.length, `${key}: command endpoint with no drive site`).toBeGreaterThan(0);
      expect(endpoint.drivenBy.every((d) => d.mode === 'dispatch'), key).toBe(true);
    }
  });

  it('every endpoint reachable only by direct dispatch (no divertedFrom) has a real drive site', () => {
    for (const endpoint of document.endpoints) {
      if (endpoint.kind === 'endpoint' && endpoint.divertedFrom.length === 0) {
        expect(
          endpoint.drivenBy.length,
          `${endpoint.key}: bound, non-divert endpoint with no drive site`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('toggleCell: bound but in production only ever reached via strokeStart/strokeMove divert, never dispatched directly', () => {
    // Also evidence that the cross-package drivenBy detection does not
    // over-detect — dispatch(SimActions.toggleCell(...)) does not actually
    // exist anywhere, so drivenBy stays empty.
    const toggleCell = document.endpoints.find((e) => e.key === 'Circuit.Sim.toggleCell');
    expect(toggleCell?.divertedFrom).toEqual(['Circuit.Sim.strokeStart', 'Circuit.Sim.strokeMove']);
    expect(toggleCell?.drivenBy).toEqual([]);
  });

  it('never leaves a driveSite unattributed', () => {
    // SimPort's play/pause/step/strokeEnd are thin handlers that just
    // kernel.run — not root pipes — so they have no catalog entry, and their
    // action-creator dispatches would not resolve to a catalogued key. Being
    // first-class command endpoints with drivenBy attribution is what keeps
    // this list at zero.
    const unresolved = document.unresolved ?? [];
    expect(unresolved.filter((u) => u.kind === 'driveSite')).toEqual([]);
  });

  it('never leaves a state access unattributed — every wiring-graph unresolved entry is exactly ASSEMBLED_WIRING_ISSUE_ALLOWLIST', () => {
    const unresolved = document.unresolved ?? [];
    // There must not be a single stateWrite/stateRead unresolved (every
    // buffer.read/mutate is receiver-type-guarded by the type checker and
    // should be attributable to one of the 9 catalog entries).
    const accessMisses = unresolved.filter((u) => u.kind === 'stateWrite' || u.kind === 'stateRead');
    expect(accessMisses).toEqual([]);

    // The 3 wiring-graph kinds (divertTarget/orphanEntry/unlistedBoundSymbol,
    // the same vocabulary as introspect.ts's WIRING_GRAPH_ISSUE_KINDS) = the set
    // failOnWiringIssues watches. Whatever of these the assembled unresolved
    // contains must match the ASSEMBLED-layer allowlist **exactly, no more and
    // no less** (ASSEMBLED = RAW ∖ the 4 promoted, guaranteed by derivation. If
    // the promotion regresses and play etc. reappear, this match breaks AND
    // failOnWiringIssues in introspect.config.ts becomes a hard CI error).
    const wiringGraphKinds = new Set(['divertTarget', 'orphanEntry', 'unlistedBoundSymbol']);
    const wiringGraphIssues = unresolved.filter((u) => wiringGraphKinds.has(u.kind));
    expect(wiringGraphIssues).toHaveLength(ASSEMBLED_WIRING_ISSUE_ALLOWLIST.length);
    for (const entry of ASSEMBLED_WIRING_ISSUE_ALLOWLIST) {
      // Inside detail the id is always quoted ("...") — the same quote-inclusive
      // match as introspect.ts, so Circuit.Sim.step cannot morph into
      // Circuit.Sim.stepOnce.
      expect(
        wiringGraphIssues.some((u) => u.kind === entry.kind && u.detail.includes(`"${entry.key}"`)),
        `${entry.kind}: ${entry.key}`,
      ).toBe(true);
    }
    // The 4 promoted entries (play/pause/step/strokeEnd) no longer linger as
    // unlistedBoundSymbol (positive evidence the suppression works — the 4→0
    // reversal itself). They are not in the ASSEMBLED list either, so the exact
    // match above already implies this, but state it explicitly.
    for (const key of COMMAND_KEYS) {
      expect(
        wiringGraphIssues.some((u) => u.kind === 'unlistedBoundSymbol' && u.detail.includes(`"${key}"`)),
        key,
      ).toBe(false);
    }
    // stateDeclaration (from KernelErrorState) is outside the wiring-graph
    // vocabulary and thus outside failOnWiringIssues, but confirm it is
    // explicitly reported rather than silent (not a dangling reference).
    expect(
      unresolved.some((u) => u.kind === 'stateDeclaration' && u.detail.includes('"KernelErrorState"')),
    ).toBe(true);
  });

  it('no dangling state reference: every readsState/writesState state name exists in states[]', () => {
    const declared = new Set((document.states ?? []).map((s) => s.name));
    const referenced = new Set(
      document.endpoints.flatMap((e) => [...e.readsState, ...e.writesState].map((a) => a.state)),
    );
    for (const name of referenced) {
      expect(declared.has(name), `state "${name}" referenced by an endpoint but missing from states[]`).toBe(true);
    }
    // Concretely, KernelErrorState (framework-injected) is present in states[].
    expect(declared.has('KernelErrorState')).toBe(true);
  });

  it('KernelErrorState is tokenized: declaration (null + report) / write (errorSink phase) / read (useKernelError)', () => {
    // Declaration: framework-injected (from kernelee's buffer.ts build()), so
    // there is no defineState site inside the app → declaration: null, plus an
    // explicit stateDeclaration unresolved so the "why null" is not silent.
    const kes = (document.states ?? []).find((s) => s.name === 'KernelErrorState')!;
    expect(kes.declaration).toBeNull();
    expect(
      (document.unresolved ?? []).some((u) => u.kind === 'stateDeclaration' && u.detail.includes('"KernelErrorState"')),
    ).toBe(true);

    // Read: ErrorBanner's useKernelError() shows up in readBy (a separate hook from useBuffer).
    expect(kes.readBy.map((r) => r.site)).toEqual(['src/presentation/ErrorBanner.tsx:10']);

    // Write: the mutate inside play's .catch(). The phase is 'errorSink', not
    // 'command' (the error-sink path for a failed launched pipe, not a
    // synchronous effect of play).
    const play = document.endpoints.find((e) => e.key === 'Circuit.Sim.play')!;
    const kesWrite = play.writesState.find((w) => w.state === 'KernelErrorState');
    expect(kesWrite?.phase).toBe('errorSink');
    // launchTickLoop lives in running.mutator.ts — it is a buffer transition +
    // fire-and-forget launch with no symbol call, the Mutator definition
    // verbatim, sitting next to play/pause (which delegate to it). The
    // errorSink-phase KernelErrorState write is in its .catch.
    expect(kesWrite?.site).toBe('src/circuit/sim/running.mutator.ts:51');
    // play's own synchronous write (LoopState.phase) stays 'command' (not
    // conflated). The LoopState recovery inside .catch (error→idle) is a
    // separate write site to the same state, and that one is 'errorSink'.
    expect(play.writesState.filter((w) => w.state === 'LoopState').map((w) => w.phase).sort()).toEqual([
      'command',
      'errorSink',
    ]);
  });

  it('representative state-graph values hold: GridState/StatsState writers and presentation readers', () => {
    // tickLoop/stepOnce are also GridState/StatsState writers — the write lives
    // inside the shared helper appendGeneration's `.effect` (generation.ts),
    // not directly under the endpoint's scope, but the static scan's helper
    // following picks it up. The same 4 also match diffStats.usedByStagesOf
    // (the shared-symbol test below).
    const gridWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'GridState')).map((e) => e.key),
    );
    expect(gridWriters).toEqual(
      new Set(['Circuit.Sim.tickLoop', 'Circuit.Sim.stepOnce', 'Circuit.Sim.randomize', 'Circuit.Sim.toggleCell']),
    );

    const statsWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'StatsState')).map((e) => e.key),
    );
    expect(statsWriters).toEqual(
      new Set(['Circuit.Sim.tickLoop', 'Circuit.Sim.stepOnce', 'Circuit.Sim.randomize', 'Circuit.Sim.toggleCell']),
    );

    // That write lives in appendGeneration's `.effect`, so the phase is 'effect'.
    for (const key of ['Circuit.Sim.tickLoop', 'Circuit.Sim.stepOnce']) {
      const endpoint = document.endpoints.find((e) => e.key === key)!;
      expect(endpoint.writesState.find((w) => w.state === 'GridState')?.phase, key).toBe('effect');
    }

    const states = document.states ?? [];
    // states[].writtenBy records presentation-side observations — direct
    // evidence that the "views only read" discipline (react-kernelee useBuffer
    // is read-only) is unbroken.
    for (const state of states) {
      expect(state.writtenBy, state.name).toEqual([]);
    }
    const byName = new Map(states.map((s) => [s.name, s]));
    expect(byName.get('GridState')?.readBy.map((r) => r.site).sort()).toEqual([
      'src/presentation/ControlBar.tsx:26',
      'src/presentation/GridCanvas.tsx:41',
      'src/presentation/StatusBar.tsx:14',
    ]);
    expect(byName.get('StatsState')?.readBy.map((r) => r.site)).toEqual(['src/presentation/StatusBar.tsx:15']);
    // LoopState is also read by ControlBar — the phase===running disabled logic.
    expect(byName.get('LoopState')?.readBy.map((r) => r.site)).toEqual(['src/presentation/ControlBar.tsx:24']);
    // StrokeState is never read from presentation (causality internal to circuit).
    expect(byName.get('StrokeState')?.readBy).toEqual([]);
  });

  it('a symbol shared by 2+ endpoints names all its real users (shared-stage analogue)', () => {
    const symbols = document.symbols;
    const diffStats = symbols.find((s) => s.id === 'Compute.Life.diffStats');
    expect(diffStats?.usedByStagesOf).toEqual([
      'Circuit.Sim.tickLoop',
      'Circuit.Sim.stepOnce',
      'Circuit.Sim.randomize',
      'Circuit.Sim.toggleCell',
    ]);
    const save = symbols.find((s) => s.id === 'Infrastructure.Settings.save');
    expect(save?.usedByStagesOf).toEqual(['Circuit.Settings.setSpeed', 'Circuit.Settings.setGranularity']);
    expect(symbols.every((s) => s.bound)).toBe(true);
  });

  it('declares its own current coverage ceiling honestly (not an aspirational value)', () => {
    expect(document.meta.schemaVersion).toBe(8);
    // The honest current reach on the TS side — symbol-usage coverage stops at
    // the lower bound of explicit-symbolId stages + static call-site scanning
    // (not complete). It should flip to true only when coverage is actually
    // complete; if the value drifts, this test catches it.
    expect(document.meta.symbolUsage.complete).toBe(false);
    expect(document.meta.declarations?.coverage).toContain('ts-morph static scan');
    expect(document.meta.workingTreeHash).not.toBeNull();
  });

  it('recovers the granularity value→branch mapping as data — one builder, three ranges', () => {
    // The three branch builders are unified into the single `rangeBranch`, but
    // **the table (BRANCH_FAMILIES) must stay**. Folding the table into a
    // `switch` statement makes `valueSelectors` (the granularity value set),
    // the fork's `branchSelector` correlation edge, and the branches'
    // per-stage `flows` vanish from the index simultaneously — a silent hole
    // that does not even show up as unresolved (the detector only reads the
    // module-scope table + direct `TABLE[param](...)` return shape). "Unifying
    // into one builder" and "dropping the table" are separate changes.
    const selectors = document.valueSelectors ?? [];
    const branchesFor = selectors.find((s) => s.functionName === 'branchesFor');
    expect(branchesFor?.discriminantType).toBe('ForkGranularity');
    expect(Object.keys(branchesFor?.cases ?? {}).sort()).toEqual(['cell', 'chunk', 'row']);
    // Every case calls the same builder — the unification is pinned by this one line.
    for (const caseText of Object.values(branchesFor?.cases ?? {})) {
      expect(caseText).toContain('rangeBranch');
    }
  });

  it('a runtime-arity fork always carries a branchSelector — the consumer floor, checked on the output side', () => {
    // The test above checks "the table is readable"; this one checks "the table
    // reaches the fork". Separate facts: folding the table into a switch drops
    // both at once, but that is not the only way to break it (writing
    // `.fork(Array.from(ranges, r => rangeBranch(r)))` directly involves no
    // switch anywhere). There are endless ways to break it, so instead of a
    // lint banning input shapes, look at the output fact directly.
    //
    // branchArity being runtime = the branch list is chosen per call by a
    // "value". Then the chosen function must have a name. Fixed-arity forks
    // (the stats line's `.fork(pipeline(…), pipeline(…))`) have no chooser and
    // are out of scope.
    const runtimeForks = document.endpoints.flatMap((endpoint) =>
      allStages(endpoint.stages)
        .filter((stage) => stage.kind === 'fork(branches)' && stage.branchArity?.kind === 'runtime')
        .map((stage) => ({ key: endpoint.key, stage })),
    );
    expect(runtimeForks.length).toBeGreaterThan(0); // never let zero subjects make this vacuously true
    for (const { key, stage } of runtimeForks) {
      expect(stage.branchSelector?.functionName, `${key}: runtime arity fork without branchSelector`).toBe(
        'branchesFor',
      );
    }
    // The correlation edge's destination must exist (dangling would make "it has a name" a lie).
    const sites = new Set((document.valueSelectors ?? []).map((s) => s.site));
    for (const { stage } of runtimeForks) expect(sites.has(stage.branchSelector!.site)).toBe(true);
  });

  it("gives named stage handlers an address — tickLoop's two effects are distinguishable", () => {
    // The motivation itself: without named handlers, tickLoop would carry two
    // effect stages with symbolId/note/handler all null, and the index alone
    // could not tell which is the sleep and which is the buffer write. Both are
    // bare identifiers (sleepForSpeed / applyGenerationResult), so both have an
    // address.
    const tickLoop = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;
    // Both are named handlers (sleepForSpeed / applyGenerationResult), so —
    // kernel-introspect StageKind symbol/function/closure operand split —
    // they mint `effect(function)`, not `effect(closure)`.
    const effects = allStages(tickLoop.stages).filter((s) => s.kind === 'effect(function)');
    expect(effects).toHaveLength(2);
    expect(effects.filter((s) => s.handler !== null)).toHaveLength(2);
    const sleep = effects.find((s) => s.handler!.functionName === 'sleepForSpeed')!;
    expect(sleep.handler!.functionName).toBe('sleepForSpeed');
    // site is where the body lives (the grep target), not the wiring site.
    expect(sleep.handler!.site).toBe('src/circuit/sim/tickLoop.ts:27');
    const commit = effects.find((s) => s.handler!.functionName === 'applyGenerationResult')!;
    expect(commit.handler!.site).toBe('src/circuit/sim/generation.mutator.ts:30');

    // KernelSymbol stages stay null — symbolId is already their identity, and
    // the same fact never gets a second address.
    //
    // Duplicates in the list below are real shared usage, not noise:
    // cellVisitGate appears twice because strokeStart/strokeMove share the
    // appendStrokeVisit stage sequence; mergeGranularityBranches /
    // packGenerationResult / applyGenerationResult appear twice because
    // tickLoop/stepOnce share appendGeneration. Entry-position bare identifiers
    // (`pipeline(meta, fn)`) are detected the same as chain-link arguments —
    // runningPhaseGate / idlePhaseGate / granularityGateAndPayload /
    // inStrokeGate / armStrokeState all have addresses. The Mutator-part
    // extraction contributes the apply* family (buffer-transition tail effects
    // that call no symbols) as named handlers too.
    const named = document.endpoints.flatMap((e) => allStages(e.stages)).filter((s) => s.handler !== null);
    expect(named.map((s) => s.handler!.functionName).sort()).toEqual([
      'applyGenerationResult',
      'applyGenerationResult',
      'applyGranularity',
      'applyHydratedSettings',
      'applyRandomizeResult',
      'applySpeed',
      'applyToggleStats',
      'armStrokeState',
      'cellVisitGate',
      'cellVisitGate',
      'granularityGateAndPayload',
      'granularitySwitch',
      'idlePhaseGate',
      'inStrokeGate',
      'loadedSettingsGate',
      'mergeGranularityBranches',
      'mergeGranularityBranches',
      'packGenerationResult',
      'packGenerationResult',
      'packRandomizeResult',
      'runningPhaseGate',
      'sleepForSpeed',
    ]);
    expect(named.every((s) => s.symbolId === null)).toBe(true);
  });

  it('recovers the non-next verbs each endpoint can emit, following shared-stage helpers', () => {
    // A lightweight structuring: not the predicates' contents, only the boolean
    // of "can this pipe emit abort/fail/divert". A structural guarantee that
    // stays true even if the note wording rots. Each value is a sorted subset
    // of ["abort","divert","fail"].
    const byKey = new Map(document.endpoints.map((e) => [e.key, e.emittableVerbs]));
    for (const endpoint of document.endpoints) {
      expect(endpoint.emittableVerbs.every((v) => ['abort', 'divert', 'fail'].includes(v)), endpoint.key).toBe(true);
    }
    // tick/step abort on the running guard — the abort lives in the bodies of
    // the cross-file helpers tickLoopPipeFor/stepOncePipeFor (picked up by
    // helper following). With runningPhaseGate/idlePhaseGate as named
    // functions the value stays ['abort'] — only divert is excluded from the
    // aggregation, while abort/fail are counted even inside named handler
    // bodies. Mechanical evidence that naming a handler does not make its
    // emittableVerbs disappear.
    expect(byKey.get('Circuit.Sim.tickLoop')).toEqual(['abort']);
    expect(byKey.get('Circuit.Sim.stepOnce')).toEqual(['abort']);
    // stroke's abort (outside-the-board / same cell) and divert (to togglePipe)
    // live inside the shared appendStrokeVisit stages (cellVisitGate, a named
    // function). Even in a named handler's body, divert alone is excluded from
    // emittableVerbs — divertsTo/symbolId already hold that edge's address
    // (avoiding double counting). abort has no such alternate channel, so it is
    // counted: strokeStart picks up cellVisitGate's abort → ['abort'];
    // strokeMove's aborts from cellVisitGate and from its own entry gate
    // (inStrokeGate) de-dupe into the same Set → ['abort'].
    expect(byKey.get('Circuit.Sim.strokeStart')).toEqual(['abort']);
    expect(byKey.get('Circuit.Sim.strokeMove')).toEqual(['abort']);
    // Unknown-value gate → abort.
    expect(byKey.get('Circuit.Settings.setGranularity')).toEqual(['abort']);
    expect(byKey.get('Circuit.Settings.hydrateSettings')).toEqual(['abort']);
    // The floor on the undetected side: the tick loop's self-divert is a
    // delegation to granularitySwitch (a Switch part), not an inline divert()
    // call, so it does not appear here — divertsTo holds it.
    expect(byKey.get('Circuit.Sim.tickLoop')).not.toContain('divert');
    // There is not a single fail( in the real app.
    expect(document.endpoints.every((e) => !e.emittableVerbs.includes('fail'))).toBe(true);
  });

  it('recovers per-stage flows across builder-helper seams and flat chains, kind-verified', () => {
    const byKey = new Map(document.endpoints.map((e) => [e.key, e]));

    // tickLoop/stepOnce (cachedPipe + appendGeneration) and stroke
    // (appendStrokeVisit) are assembled by cross-file builder helpers. The
    // chain-splicer penetrates the seam, so the flows of every top-level stage
    // are recovered with concrete types (with a safety net that matches each
    // link's derived kind against the projected stage kind and refuses to
    // attach on a mismatch).
    // Root/entry gates and the two named `.map`/`.effect` links (bare
    // identifiers — mergeGranularityBranches/packGenerationResult/
    // applyGenerationResult/sleepForSpeed/granularitySwitch/cellVisitGate/
    // armStrokeState/inStrokeGate) mint the `(function)` operand; the two
    // remaining inline-arrow assembly stages per chain stay `(closure)`
    // (kernel-introspect StageKind symbol/function/closure operand split).
    const expectedKinds: Record<string, string[]> = {
      'Circuit.Sim.tickLoop': [
        'pipe(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'effect(function)',
        'effect(function)',
        'pipe(function)',
      ],
      'Circuit.Sim.stepOnce': [
        'pipe(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'effect(function)',
      ],
      'Circuit.Sim.strokeStart': ['pipe(function)', 'pipe(closure)', 'pipe(symbol)', 'pipe(function)'],
      'Circuit.Sim.strokeMove': ['pipe(function)', 'pipe(closure)', 'pipe(symbol)', 'pipe(function)'],
    };
    for (const [key, kinds] of Object.entries(expectedKinds)) {
      const stages = byKey.get(key)?.stages ?? [];
      expect(stages.map((s) => s.kind), key).toEqual(kinds);
      expect(stages.every((s) => s.flows !== null), key).toBe(true);
    }
    // appendGeneration's tail .effect writes the board — the cursor is the generation result (cells/stats).
    const tickEffect = byKey.get('Circuit.Sim.tickLoop')?.stages[7];
    expect(tickEffect?.kind).toBe('effect(function)');
    expect(tickEffect?.flows).toContain('cells');

    // randomize is a flat chain within a single file (regression guard — it must stay populated).
    const randomizeStages = byKey.get('Circuit.Sim.randomize')?.stages ?? [];
    expect(randomizeStages).toHaveLength(6);
    expect(randomizeStages.every((s) => s.flows !== null && s.flows.length > 0)).toBe(true);

    // Every splice passes the kind match, and there is not a single misaligned-'flows' unresolved.
    expect((document.unresolved ?? []).some((u) => u.kind === 'flows')).toBe(false);
  });

  it('every symbol carries both the declaration (contract) and implementation (device body) address — the floor for "what lies beyond" a symbol stage', () => {
    // declaration is the defineCallable spec member (contract/ports.ts);
    // implementation is the body reached by import-following the device
    // object's member (compute/life.ts for Compute, the factory-returned
    // literal in settingsStore.ts for Infrastructure). If either regresses to
    // null, the devtools panel's declaration/implementation links silently
    // disappear (there is a pact that null ⟹ an unresolved report, so a
    // regression also shows in the unresolved kind breakdown).
    expect(document.symbols.length).toBeGreaterThanOrEqual(6);
    for (const symbol of document.symbols) {
      expect(symbol.declaration?.site, symbol.id).toMatch(/^src\/contract\/ports\.ts:\d+$/);
      expect(symbol.declaration?.doc, symbol.id).not.toBeNull();
      expect(symbol.implementation?.site, symbol.id).toMatch(/^src\/.+\.tsx?:\d+$/);
    }
  });

  it('every stage (branches included) carries a wireSite — inline closure / symbol stages also have the wiring line as an address (the open-in-editor floor)', () => {
    // handler.site exists only on bare-identifier delegate stages, but wireSite
    // is "the call line that wired this stage", so every link of a resolved
    // chain has one. If this regresses to null, the devtools panel's source
    // links silently disappear, so the floor is laid on "every stage" rather
    // than a total count (the same rationale as watching the unresolved total).
    const collect = (stages: readonly (typeof document.endpoints)[number]['stages'][number][]): string[] =>
      stages.flatMap((s) => [
        ...(s.wireSite === null ? ['MISSING'] : [s.wireSite]),
        ...s.branches.flatMap((b) => collect(b)),
      ]);
    const sites = document.endpoints.flatMap((e) => collect(e.stages));
    expect(sites.length).toBeGreaterThanOrEqual(69); // total stage count of the current catalog (shrinking = regression signal)
    expect(sites.filter((s) => s === 'MISSING')).toEqual([]);
    expect(sites.every((s) => /^src\/.+\.tsx?:\d+$/.test(s))).toBe(true);
  });

  it('named-mutation vocabulary (StateAccessEntry.via) is a genuine soft-null, explicitly reported', () => {
    // All 15 catalogued-pipe buffer.mutate sites are object-literal spread
    // rebuilds of the `(state) => ({ ...state, field: value })` shape, not
    // named method calls — via at 0/15 is the honest current state. The scope
    // is catalogued pipes only (kind !== 'command') — command endpoints'
    // LoopState writes (play/pause) are outside this aggregate.
    const catalogedEndpoints = document.endpoints.filter((e) => e.kind !== 'command');
    const totalMutateSites = catalogedEndpoints.reduce((n, e) => n + e.writesState.length, 0);
    const resolvedViaCount = catalogedEndpoints.reduce(
      (n, e) => n + e.writesState.filter((w) => w.via !== null).length,
      0,
    );
    expect(resolvedViaCount).toBe(0);
    expect(totalMutateSites).toBeGreaterThan(0);

    const summary = (document.unresolved ?? []).find((u) => u.kind === 'namedMutationVia');
    expect(summary).toBeDefined();
    expect(summary?.detail).toContain(`resolved for 0/${totalMutateSites}`);

    // mutatingMethods exist on none of Grid/Sim/Stats (plain readonly data
    // interfaces) — the permanent [] is an honest scan result, not a hardcoded
    // stub.
    for (const state of document.states ?? []) {
      expect(state.mutatingMethods, state.name).toEqual([]);
    }
  });

  it('presentation-write scan finds zero real useKernel() escape-hatch writes', () => {
    // The same fact as the writtenBy-is-[] assertion in the state-graph test,
    // from another angle: the scan for writes via the useKernel() escape hatch
    // itself is implemented (the positive path is verified by synthetic tests
    // on the kernelee-mcp-tools side) — this repository's presentation actually
    // uses none, so [] is an honest zero.
    for (const state of document.states ?? []) {
      expect(state.writtenBy, state.name).toEqual([]);
    }
  });

  it('reports zero off-Buffer control values — stroke/loop causality lives in Buffer states', () => {
    // Both candidates for off-Buffer control values (stroke interpretation
    // state, loop liveness) are real Buffer cells (StrokeState/LoopState), so
    // the honest count is 0 — the machine-checkable form of "the Buffer is the
    // home of everything causal". The scanner's own ability to still DETECT a
    // real one (not just report absence because it stopped looking) is proven
    // independently in kernelee-mcp-tools' scan.integration.test.ts via a
    // synthetic fixture.
    const offBuffer = (document.unresolved ?? []).filter((u) => u.kind === 'offBufferControlValue');
    expect(offBuffer).toEqual([]);
  });

  it('accounts for every unresolved entry: exactly the known 4 (stateDeclaration + namedMutationVia + wiring-graph 2)', () => {
    // A record of the current reach. The remaining 4 are each either a
    // detection success or a deliberate scan-scope boundary:
    //   stateDeclaration  — KernelErrorState lives in kernelee core (outside the scan root)
    //   namedMutationVia  — contract states have 0 methods (soft-null; the writes themselves are indexed)
    //   orphanEntry ×2    — tickLoop/stepOnce are kernel.run-launched + self-divert only
    //                       (inherent to the launch path; permanent even with a complete catalog)
    // If this number grows, look at the kind breakdown in the diff first — a
    // total alone cannot reveal offsetting changes.
    const unresolved = document.unresolved ?? [];
    const byKind = new Map<string, number>();
    for (const entry of unresolved) byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual({
      stateDeclaration: 1,
      namedMutationVia: 1,
      orphanEntry: 2,
    });
    expect(unresolved).toHaveLength(4);
  });

  it('every pipe(closure) stage always carries a note — the gate/assembly family has no other identity (CI floor)', () => {
    // pipe(closure) stages are gates/assembly and note is their only identity
    // channel — symbolId (that's the `symbol` operand) and handler (that's
    // the `function` operand) are both structurally absent for `(closure)`
    // stages after kernel-introspect's StageKind symbol/function/closure
    // operand split: a stage cannot be BOTH `(closure)` and named, so
    // "anonymous pipe(closure)" and "pipe(closure)" are now the same set —
    // the old `symbolId === null && handler === null` guard is gone, not
    // weakened; `kind === 'pipe(closure)'` alone already implies both are
    // null (kernelee's `handlerNameOf`/`StageKind` cast the two from the same
    // check, never independently). Without a note, such a stage would be
    // index-invisible: nothing says what it does. Walk every stage recursively
    // down into fork branches (branches inside forks take the same
    // pipe(closure) shape).
    //
    // A diff that lowers this expectation (allowing a note-less pipe(closure))
    // is a regression signal — lint (types/conventions on the implementation
    // side) can only guarantee that a note "exists", not that its content is
    // correct (that the name=identity and note=intent are not betrayed). This
    // test's job is to close the hole of shipping them empty (per the lesson
    // that a completeness net must not bless regressions, expectation-lowering
    // diffs must be the strongest regression signal).
    for (const endpoint of document.endpoints) {
      for (const stage of allStages(endpoint.stages)) {
        if (stage.kind === 'pipe(closure)') {
          expect(stage.note, `${endpoint.key}: pipe(closure) stage without note`).not.toBeNull();
        }
      }
    }
  });

  it('every *.switch.ts / *.emitter.ts part file is referenced by some StageEntry.handler.site — no dead part file', () => {
    // One side of the machine floor supporting the branching (*.switch.ts) /
    // converging (*.emitter.ts) topology classification: "if it exists as a
    // part file, it is actually referenced from some handler.site in the index"
    // (prevention of dead part files).
    //
    // The asymmetry is deliberate and stated: the reverse direction (that every
    // branching pipe(closure) in the index lives in *.switch.ts) is out of this
    // test's scope. Exhaustively tracking the existing anonymous pipe(closure)
    // gates (like the caller-side note of the outside-the-board/same-cell gate —
    // gates not yet named functions, or deliberately outside selects-only)
    // would require interpreting note wording, not just handler, so it is
    // deliberately not done here.
    const handlerSites = new Set(
      document.endpoints.flatMap((e) => allStages(e.stages)).map((s) => s.handler?.site).filter((s): s is string => !!s),
    );
    const parts = partFiles(srcRoot);
    expect(parts.length).toBeGreaterThan(0); // never let zero subjects make this vacuously true
    for (const part of parts) {
      const referenced = [...handlerSites].some((site) => site.startsWith(`${part}:`));
      expect(referenced, `${part}: no StageEntry.handler.site references this part file`).toBe(true);
    }
  });

  it('parts: all 15 part files (switch 7 / emitter 2 / mutator 6) are indexed with usedBy — the subgraph as nodes', () => {
    // The test above (the handler.site reference floor) is "prevention of dead
    // part files" seen from the filesystem side. This one is the index itself
    // producing the parts section — the subgraph-as-nodes answer to "can this
    // fact be obtained without leaving the index?" (paving the index). The
    // expectation is pinned by count and breakdown (a completeness net must not
    // bless regressions — an expectation-lowering diff is the strongest
    // regression signal).
    //
    // The 6 mutators: running / generation / randomize / toggleCell / stroke /
    // simState. The bridge kind exists as a slot but lifegame has 0 (the slot
    // existing is itself meaningful — see arch-circuit.md), so it does not
    // appear in byKind.
    const parts = document.parts ?? [];
    const byKind = new Map<string, number>();
    for (const part of parts) byKind.set(part.kind, (byKind.get(part.kind) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual({ switch: 7, emitter: 2, mutator: 6 });
    expect(parts).toHaveLength(15);
    expect(parts.filter((p) => p.kind === 'bridge')).toEqual([]);

    // usedBy is non-empty for every part (empty would raise a partUsage
    // unresolved — the index-side shape of the same CI-floor fact).
    for (const part of parts) {
      expect(part.usedBy.length, `${part.file}: dead part file (usedBy empty)`).toBeGreaterThan(0);
    }
    expect((document.unresolved ?? []).filter((u) => u.kind === 'partUsage')).toEqual([]);

    // A part's identity is (name, kind) — the owning pipeline goes into name
    // and the role into kind. generation / randomize share a name between
    // emitter and mutator, so name alone cannot look them up.
    const byId = new Map(parts.map((p) => [`${p.name}.${p.kind}`, p]));
    expect(byId.size).toBe(parts.length); // the (name, kind) uniqueness itself is a floor
    // Representative values: shared parts name all their users (usedBy is sorted).
    expect(byId.get('generation.emitter')?.usedBy).toEqual(['Circuit.Sim.stepOnce', 'Circuit.Sim.tickLoop']);
    expect(byId.get('cellVisit.switch')?.usedBy).toEqual(['Circuit.Sim.strokeMove', 'Circuit.Sim.strokeStart']);
    // A mutator's usedBy is the UNION of StageEntry.handler.site (chain-link /
    // entry bare identifiers) and command endpoints' declaration sites
    // (assembly.ts) — either path counts regardless of kind. running goes via
    // command (play/pause; the Mutator calls no symbols and is not a stage —
    // per running.mutator.ts's own doc).
    expect(byId.get('running.mutator')?.usedBy).toEqual(['Circuit.Sim.pause', 'Circuit.Sim.play']);
    // The generation/randomize/toggleCell mutators go via handler.site
    // (bare identifiers of chain-link `.effect(...)`).
    expect(byId.get('generation.mutator')?.usedBy).toEqual(['Circuit.Sim.stepOnce', 'Circuit.Sim.tickLoop']);
    expect(byId.get('randomize.mutator')?.usedBy).toEqual(['Circuit.Sim.randomize']);
    expect(byId.get('toggleCell.mutator')?.usedBy).toEqual(['Circuit.Sim.toggleCell']);
    // stroke is the living example of the UNION: armStrokeState is
    // strokeStartPipe's entry (handler.site), strokeEnd is a command
    // declaration site — different functions in the same file produce two
    // usedBy entries via different paths.
    expect(byId.get('stroke.mutator')?.usedBy).toEqual(['Circuit.Sim.strokeEnd', 'Circuit.Sim.strokeStart']);
    // simState: the 3 sagas setSpeed/setGranularity/hydrateSettings each point
    // at a different function in the same single file via handler.site.
    expect(byId.get('simState.mutator')?.usedBy).toEqual([
      'Circuit.Settings.hydrateSettings',
      'Circuit.Settings.setGranularity',
      'Circuit.Settings.setSpeed',
    ]);
    // Singly-used parts are indexed too (unlike sharedStages, parts have no shared-count cutoff).
    expect(byId.get('granularity.switch')?.usedBy).toEqual(['Circuit.Sim.tickLoop']);
    expect(byId.get('idlePhase.switch')?.usedBy).toEqual(['Circuit.Sim.stepOnce']);
    expect(byId.get('inStroke.switch')?.usedBy).toEqual(['Circuit.Sim.strokeMove']);
    expect(byId.get('runningPhase.switch')?.usedBy).toEqual(['Circuit.Sim.tickLoop']);
    expect(byId.get('randomize.emitter')?.usedBy).toEqual(['Circuit.Sim.randomize']);
    expect(byId.get('knownGranularity.switch')?.usedBy).toEqual(['Circuit.Settings.setGranularity']);
    expect(byId.get('loadedSettings.switch')?.usedBy).toEqual(['Circuit.Settings.hydrateSettings']);
  });

  /**
   * CI floor: every writesState must either live in `*.mutator.ts` or be on the
   * allowlist of declared exceptions (buffer transitions inseparable from a
   * decision/computation) — the errorSink phase (framework error plumbing like
   * launchTickLoop's `.catch`) is out of scope.
   *
   * This is a "debt list", not an approval (per the lesson that a completeness
   * net must not bless regressions) — when a new writesState site appears, this
   * test goes RED by default. Two ways back to GREEN: (a) extract the write
   * into `*.mutator.ts` (the default answer), or (b) if it is genuinely
   * inseparable, declare the reason in that file's own doc comment and append
   * it to this allowlist (currently 3 entries).
   */
  const WRITES_STATE_MUTATOR_ALLOWLIST: ReadonlyArray<{ readonly file: string; readonly reason: string }> = [
    {
      file: 'src/circuit/sim/runningPhase.switch.ts',
      reason:
        'The aborting branch carries the write that settles LoopState on idle, inseparably from the decision ' +
        '(no stage follows, so there is nowhere to extract the write to) — declared in ' +
        "runningPhase.switch.ts's own doc comment.",
    },
    {
      file: 'src/circuit/sim/cellVisit.switch.ts',
      reason:
        'Deciding "which cell to toggle next" and updating StrokeState.last can only happen atomically inside ' +
        'the same single check (extracting the update after the check would lose the basis for suppressing ' +
        "same-cell repeats) — declared in cellVisit.switch.ts's own doc comment.",
    },
    {
      file: 'src/circuit/sim/toggleCell.ts',
      reason:
        'Computing the toggle target index and writing GridState happen atomically inside the same mutate ' +
        'callback — the grid the callback receives is the buffer\'s very latest value at that instant, so moving ' +
        'the computation outside the callback opens a read→write race window against the tick loop and could ' +
        "roll the board back. Declared in toggleCell.ts's own doc comment. The trailing StatsState side is not " +
        'inseparable and is extracted to toggleCell.mutator.ts.',
    },
  ];

  it('writesState lives in *.mutator.ts or in a declared-exception *.switch.ts — errorSink excluded (CI floor)', () => {
    const fileOf = (site: string): string => site.replace(/:\d+$/, '');
    const allowlistedFiles = new Set(WRITES_STATE_MUTATOR_ALLOWLIST.map((e) => e.file));

    // `endpoint.writesState` is already the fully-attributed, recursively
    // collected list (fork branches included) — no separate stage-tree walk
    // needed here, unlike the note/handler checks above that inspect
    // StageEntry directly.
    const offenders: Array<{ key: string; state: string; site: string }> = [];
    for (const endpoint of document.endpoints) {
      for (const write of endpoint.writesState) {
        if (write.phase === 'errorSink') continue; // framework error-sink channel, out of scope
        const file = fileOf(write.site);
        const isMutator = file.endsWith('.mutator.ts');
        const isAllowlisted = allowlistedFiles.has(file);
        if (!isMutator && !isAllowlisted) {
          offenders.push({ key: endpoint.key, state: write.state, site: write.site });
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);

    // The debt list is actually alive (each allowlist entry is exercised by
    // real data) — confirm every entry is actually used by at least one
    // non-errorSink write (prevention of dead allowlist entries; the same
    // "never drop a miss silently" discipline as partUsage).
    const usedFiles = new Set(
      document.endpoints
        .flatMap((e) => e.writesState)
        .filter((w) => w.phase !== 'errorSink')
        .map((w) => fileOf(w.site)),
    );
    for (const entry of WRITES_STATE_MUTATOR_ALLOWLIST) {
      expect(usedFiles.has(entry.file), `${entry.file}: dead allowlist entry (no non-errorSink write there)`).toBe(
        true,
      );
    }
  });

  it('sharedStages: only builder helpers shared by 2+ endpoints are indexed — the 2 entries appendGeneration / appendStrokeVisit', () => {
    // The chain splice already knows "which endpoint went through which helper"
    // — this pins that the record is not discarded and reaches sharedStages.
    // Named stage HANDLERS (sleepForSpeed / granularitySwitch etc.) are not
    // sharedStages (that is the StageEntry.handler axis). branchesFor /
    // rangeBranch (the fork-branch-side builders) are not indexed here either
    // (valueSelectors / branchSelector are already their address). Helpers used
    // by only 1 endpoint are by definition not indexed (SharedStageEntry doc:
    // "shared by 2+ endpoints") — their absence is spec, not a miss.
    expect(document.sharedStages).toEqual([
      {
        name: 'appendGeneration',
        file: 'src/circuit/sim/generation.ts',
        usedBy: ['Circuit.Sim.stepOnce', 'Circuit.Sim.tickLoop'],
      },
      {
        name: 'appendStrokeVisit',
        file: 'src/circuit/sim/stroke.ts',
        usedBy: ['Circuit.Sim.strokeMove', 'Circuit.Sim.strokeStart'],
      },
    ]);
  });

  it('parts/sharedStages are real arrays, not null (unscanned) — types stays null, still out of scope', () => {
    // null = unscanned, [] = scanned-and-zero, real data = produced. If
    // parts/sharedStages were always null, the graphModel's usesSharedStage
    // edges and sharedStage nodes (whose receiving side is fully implemented)
    // would never fire.
    expect(Array.isArray(document.parts)).toBe(true);
    expect(Array.isArray(document.sharedStages)).toBe(true);
    // types is out of scope — an honest "unscanned" null (never lie with an
    // empty {} claiming "scanned, zero").
    expect(document.types).toBeNull();
  });
});

describe('offBufferControlValueAllowlist gate — passes on an empty allowlist by construction', () => {
  // There are no off-Buffer control values left in the code (stroke
  // interpretation state and loop liveness are real Buffer cells:
  // StrokeState/LoopState), so `document.unresolved` contains no
  // `offBufferControlValue` entry — a "THROWS when the allowlist is empty"
  // regression test cannot be exercised against real code (there is nothing
  // left to disallow, whatever allowlist is passed). That is the intended
  // outcome, not a coverage gap: the gate's actual throw mechanism
  // (`unallowed.length > 0` → throw) is the same shared shape as
  // `failOnWiringIssues`'s (exercised elsewhere in this file against the real
  // wiring-graph issues), and the scanner's continued ability to detect a real
  // off-Buffer value is proven independently, via a synthetic fixture, in
  // kernelee-mcp-tools' scan.integration.test.ts.
  it(
    'passes with the real (now empty) allowlist — the established steady state',
    async () => {
      const scratchDir = mkdtempSync(join(tmpdir(), 'kernelee-lifegame-introspect-tripwire-test-'));
      try {
        expect(OFF_BUFFER_CONTROL_VALUE_ALLOWLIST).toEqual([]);
        await expect(
          runIntrospect({
            ...introspectConfig,
            outputPath: join(scratchDir, 'index.json'),
            offBufferControlValueAllowlist: OFF_BUFFER_CONTROL_VALUE_ALLOWLIST,
          }),
        ).resolves.toBeDefined();
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
    15000, // a second full ts-morph rescan within this file — the default 5000ms is tight
  );
});
