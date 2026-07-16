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
  return stages.flatMap((stage) => [
    stage,
    ...stage.branches.flatMap(allStages),
    ...stage.untrackedBranches.flatMap(allStages),
  ]);
}

/** The 2 `command`-kind endpoints — bound `portK` port members with no
 * `describePipe`d `Pipe` behind them, so `stages: []`/`inputType: null` are
 * honest for these specifically, not the "forgot to write it" case the
 * 11-catalog-pipe floor below polices. (`play` graduated to a catalogued
 * `'endpoint'` when its launch became a `.spawn` untracked fork branch — see
 * play.ts / wiringCatalog.ts. `step` graduated the same way when its launch
 * became an in-pipe `divert` — see step.ts / wiringCatalog.ts. Neither is a
 * bare command any longer.) */
const COMMAND_KEYS = ['Circuit.Sim.pause', 'Circuit.Sim.strokeEnd'];

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
    // The 11 describePipe catalog entries + the 2 command endpoints
    // (pause/strokeEnd — first-class-tokenized drive sites).
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
    // tickLoop/stepOnce are never bound and never dispatched directly — each
    // is reached only by an external divert edge (play → tickLoop,
    // step → stepOnce) — permanent divertTarget.
    expect(byKey.get('Circuit.Sim.tickLoop')?.kind).toBe('divertTarget');
    expect(byKey.get('Circuit.Sim.stepOnce')?.kind).toBe('divertTarget');
    for (const key of [
      'Circuit.Sim.play', // catalogued saga endpoint (its launch is a .spawn)
      'Circuit.Sim.step', // catalogued saga endpoint (its launch is a divert — see step.ts)
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
    // pause/strokeEnd: bound portK members with no describePipe entry —
    // a THIRD kind, neither 'endpoint' (needs a catalogued Pipe) nor 'divertTarget'.
    for (const key of COMMAND_KEYS) {
      expect(byKey.get(key)?.kind, key).toBe('command');
    }
  });

  it('tickLoop is reached by play\'s .spawn divert edge; stepOnce is reached by step\'s divert edge (neither is run-launched any more)', () => {
    const tickLoop = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;
    const stepOnce = document.endpoints.find((e) => e.key === 'Circuit.Sim.stepOnce')!;

    // tickLoop: divertTarget, reached by play's detached `.spawn` launcher,
    // which raw-diverts into the size-specific loop. So its incoming edge is a
    // DIVERT edge (divertedFrom includes the external referrer 'Circuit.Sim.play')
    // — NOT a `kernel.run` launch (the old launchTickLoop is gone). That
    // external referrer is exactly what resolves its former orphanEntry.
    expect(tickLoop.kind).toBe('divertTarget');
    expect(tickLoop.divertedFrom).toContain('Circuit.Sim.play');
    expect(tickLoop.drivenBy).toEqual([]); // no drive site at all — reached ONLY by divert

    // stepOnce: divertTarget, reached by step's in-pipe `divert`
    // (stepGranularity.switch.ts's stepGranularitySwitch) — the SAME
    // resolution shape as tickLoop (an external divertsTo referrer resolves a
    // former orphanEntry), but a DIFFERENT verb than play's `.spawn`: a plain
    // divert, on-bus, awaited by `kernel.run` from step's own one-line
    // delegate (step.ts). The old direct
    // `kernel.run(stepOncePipeFor(...))` launch that used to live in
    // stepOnce.ts is gone, so stepOnce.drivenBy is now empty too, exactly
    // mirroring tickLoop.
    expect(stepOnce.kind).toBe('divertTarget');
    expect(stepOnce.divertedFrom).toContain('Circuit.Sim.step');
    expect(stepOnce.drivenBy).toEqual([]); // no run-launch edge remains — the graph edge is the divert
  });

  it('every command endpoint (pause/strokeEnd) has a real drive site', () => {
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
    // schema v12: KernelErrorState is origin:'framework', so its
    // declaration:null is the expected shape, not a stateDeclaration
    // unresolved miss — confirm it is NOT reported (not "outside the
    // wiring-graph vocabulary" the way it used to be described here; it is
    // no longer in `unresolved` at all).
    expect(
      unresolved.some((u) => u.kind === 'stateDeclaration' && u.detail.includes('"KernelErrorState"')),
    ).toBe(false);
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

  it('KernelErrorState is tokenized: origin:framework + declaration:null (not unresolved) / read (useKernelError) / write now a composition-root onError policy (unscanned)', () => {
    // Declaration: framework-injected (from kernelee's buffer.ts build()), so
    // there is no defineState site inside the app → declaration: null. Schema
    // v12: origin:'framework' makes this the EXPECTED shape for a
    // framework-allocated state, not an unresolved miss — the "declaration
    // null ⟹ also in unresolved" pact now applies only to origin:'app' cells,
    // so it is NOT listed in unresolved.
    const kes = (document.states ?? []).find((s) => s.name === 'KernelErrorState')!;
    expect(kes.declaration).toBeNull();
    expect(kes.origin).toBe('framework');
    expect(
      (document.unresolved ?? []).some((u) => u.kind === 'stateDeclaration' && u.detail.includes('"KernelErrorState"')),
    ).toBe(false);

    // Read: ErrorBanner's useKernelError() shows up in readBy (a separate hook from useBuffer).
    expect(kes.readBy.map((r) => r.site)).toEqual(['src/presentation/ErrorBanner.tsx:10']);

    // Write: THE ARCHITECTURAL WIN of the detached-fork migration (card 4/4).
    // The KernelErrorState write used to be app-pipe code — the hand-rolled
    // `settleTickLoopFault` Mutator that `play`'s `void kernel.run(...).catch()`
    // delegated to. Now that `play` launches the loop as a `.spawn` untracked
    // fork branch, a branch fault routes to the framework errorSink, and the
    // KernelErrorState write moved OUT of any pipe/command into the composition
    // root's `onError` policy (driver/wiring.ts's `loopFaultSink`). That is
    // framework-boundary infrastructure, not a catalogued pipe or command
    // handler, so the static scan attributes it to no endpoint — the app no
    // longer writes KernelErrorState from its own wiring graph at all.
    const kesWrites = document.endpoints.flatMap((e) =>
      e.writesState.filter((w) => w.state === 'KernelErrorState').map((w) => ({ key: e.key, ...w })),
    );
    expect(kesWrites).toEqual([]); // no endpoint writes KernelErrorState anymore
    expect(kes.writtenBy).toEqual([]); // and no presentation write either
  });

  it('representative state-graph values hold: GridState/StatsState writers and presentation readers', () => {
    // tickLoop/stepOnce are also GridState/StatsState writers — the write lives
    // inside the shared helper appendGeneration's `.effect` (generation.ts),
    // not directly under the endpoint's scope, but the static scan's helper
    // following picks it up. The same 4 also match diffStats.usedByStagesOf
    // (the shared-symbol test below).
    //
    // `play` ALSO appears — a consequence of the detached-fork migration
    // (card 4/4). Its `.spawn` launcher (a closure reused from granularitySwitch)
    // raw-diverts into `tickLoopPipeFor`, and the scan's helper-following walks
    // that factory into the loop's own `appendGeneration` effect — the SAME
    // helper-following that gives tickLoop its writes, now reaching play through
    // its first-class launch stage (unlike the old `void kernel.run(...)` launch,
    // which the command scan skip-boundaried). So play is a TRANSITIVE board
    // writer: pressing Play does cause the board to evolve. This is honest
    // richer attribution, not a hole. (A scanner skip-boundary for `.spawn`, à
    // la `kernel.run`, would trim it — a kernelee-mcp-tools concern, out of
    // this card's scope.)
    //
    // `step` ALSO appears — the stepOnce-orphan resolution (card B004D425).
    // step.ts's `stepGranularitySwitch` diverts into `stepOncePipeFor`, and the
    // same helper-following walks that call into `appendGeneration`'s effect,
    // reaching step through its first-class divert stage. Unlike play's write
    // (phase 'detached' — reached through an UNTRACKED `.spawn` branch that
    // outlives the caller), step's write stays phase 'effect': a plain divert
    // is followed IN-LINE within the same synchronous stage tree kernel.run
    // awaits, so it is exactly as "own" a write as stepOnce's own.
    const gridWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'GridState')).map((e) => e.key),
    );
    expect(gridWriters).toEqual(
      new Set([
        'Circuit.Sim.play',
        'Circuit.Sim.tickLoop',
        'Circuit.Sim.step',
        'Circuit.Sim.stepOnce',
        'Circuit.Sim.randomize',
        'Circuit.Sim.toggleCell',
      ]),
    );

    const statsWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'StatsState')).map((e) => e.key),
    );
    expect(statsWriters).toEqual(
      new Set([
        'Circuit.Sim.play',
        'Circuit.Sim.tickLoop',
        'Circuit.Sim.step',
        'Circuit.Sim.stepOnce',
        'Circuit.Sim.randomize',
        'Circuit.Sim.toggleCell',
      ]),
    );

    // That write lives in appendGeneration's `.effect`, so the phase is
    // 'effect' — for step too (a divert, unlike play's `.spawn`, never leaves
    // the synchronous stage tree, so it never flips to 'detached').
    for (const key of ['Circuit.Sim.tickLoop', 'Circuit.Sim.step', 'Circuit.Sim.stepOnce']) {
      const endpoint = document.endpoints.find((e) => e.key === key)!;
      expect(endpoint.writesState.find((w) => w.state === 'GridState')?.phase, key).toBe('effect');
    }

    // play's board writes, by contrast, are phase 'detached' (schemaVersion 10):
    // they are reached THROUGH play's `.spawn` untracked branch (the launcher →
    // tickLoopPipeFor → appendGeneration effect), which is fire-and-forget and
    // OUTLIVES play — not play's own synchronous effect. The scanner phases them
    // 'detached' (the honest WHEN, the same axis 'errorSink' adds for faults),
    // not 'effect'. launchArmGate's own LoopState arm write is NO LONGER an
    // endpoint-level writesState entry at all (schemaVersion 11, the gate
    // migration): a gate runs before `Circuit.Sim.play`'s handler is even
    // invoked, so it has no stage-tree presence — its write surfaces instead
    // via `document.gates[].writesState` (phase 'gate'), verified in its own
    // test below. Only the untracked subtree's runningPhaseSwitch write remains
    // here.
    const play = document.endpoints.find((e) => e.key === 'Circuit.Sim.play')!;
    expect(play.writesState.find((w) => w.state === 'GridState')?.phase).toBe('detached');
    expect(play.writesState.find((w) => w.state === 'StatsState')?.phase).toBe('detached');
    expect(play.writesState.filter((w) => w.state === 'LoopState').map((w) => w.phase)).toEqual([
      'detached', // the loop's runningPhaseSwitch write, reached through the branch
    ]);

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

  it('gates: the 4 pre-handler vetoes migrated to declareGate/KernelBuilder.guard are indexed (schemaVersion 11)', () => {
    // The interceptor/gate migration: 4 pipe-entry Switch parts became
    // framework gates, each guarding exactly one port symbol. `gates` and
    // `guardEdges` are the static-scan-only halves of the schema (v11) — no
    // runtime kernel needed to read "what guards what".
    const gates = document.gates ?? [];
    expect(gates).toHaveLength(4);
    const byId = new Map(gates.map((g) => [g.id, g]));

    const launchArm = byId.get('guard:loop.launchArm')!;
    expect(launchArm.declarationSite).toBe('src/circuit/sim/launchArm.gate.ts:60');
    expect(launchArm.handler).toEqual({
      functionName: 'launchArmGate',
      site: 'src/circuit/sim/launchArm.gate.ts:49',
    });
    expect(launchArm.guardedTargets).toEqual(['Circuit.Sim.play']);
    expect(launchArm.readsState.map((r) => r.state)).toEqual(['LoopState']);
    // The double-start guard's LoopState arm write — the CI-floor exception
    // (WRITES_STATE_MUTATOR_ALLOWLIST below) — now surfaces HERE, phased
    // 'gate', not on any endpoint's writesState (see the play writesState
    // test above): moving out of the stage tree must not make the write
    // invisible to the completeness net.
    expect(launchArm.writesState.map((w) => ({ state: w.state, phase: w.phase }))).toEqual([
      { state: 'LoopState', phase: 'gate' },
    ]);

    const idlePhase = byId.get('guard:loop.idle')!;
    expect(idlePhase.handler?.functionName).toBe('idlePhaseGate');
    expect(idlePhase.guardedTargets).toEqual(['Circuit.Sim.step']);
    expect(idlePhase.readsState.map((r) => r.state)).toEqual(['LoopState']);
    expect(idlePhase.writesState).toEqual([]); // pure selects-only, no exception needed

    const inStroke = byId.get('guard:stroke.active')!;
    expect(inStroke.handler?.functionName).toBe('inStrokeGate');
    expect(inStroke.guardedTargets).toEqual(['Circuit.Sim.strokeMove']);
    expect(inStroke.readsState.map((r) => r.state)).toEqual(['StrokeState']);
    expect(inStroke.writesState).toEqual([]);

    const knownGranularity = byId.get('guard:settings.knownGranularity')!;
    expect(knownGranularity.handler?.functionName).toBe('knownGranularityGate');
    expect(knownGranularity.guardedTargets).toEqual(['Circuit.Settings.setGranularity']);
    // The payload-assembly half moved to setGranularityPipe's own new entry
    // stage (a gate's next(v) value is discarded — declareGate's own doc
    // comment) — this gate reads nothing, unlike the old cohabiting Switch.
    expect(knownGranularity.readsState).toEqual([]);
    expect(knownGranularity.writesState).toEqual([]);

    // guardEdges: one row per guarded TARGET, in fold order — today exactly
    // 1 gate per target, so gateIds is always a singleton.
    const guardEdges = document.guardEdges ?? [];
    expect(guardEdges).toHaveLength(4);
    const edgeByTarget = new Map(guardEdges.map((e) => [e.targetId, e.gateIds]));
    expect(edgeByTarget.get('Circuit.Sim.play')).toEqual(['guard:loop.launchArm']);
    expect(edgeByTarget.get('Circuit.Sim.step')).toEqual(['guard:loop.idle']);
    expect(edgeByTarget.get('Circuit.Sim.strokeMove')).toEqual(['guard:stroke.active']);
    expect(edgeByTarget.get('Circuit.Settings.setGranularity')).toEqual(['guard:settings.knownGranularity']);

    // No gate-related unresolved kind (gateId/guardTarget/guardGate/unguardedGate)
    // — every declaration resolved and every gate is actually referenced.
    const gateUnresolvedKinds = new Set(['gateId', 'guardTarget', 'guardGate', 'unguardedGate']);
    expect((document.unresolved ?? []).filter((u) => gateUnresolvedKinds.has(u.kind))).toEqual([]);
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
    expect(document.meta.schemaVersion).toBe(12);
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
    expect(sleep.handler!.site).toBe('src/circuit/sim/tickLoop.ts:26');
    const commit = effects.find((s) => s.handler!.functionName === 'applyGenerationResult')!;
    expect(commit.handler!.site).toBe('src/circuit/sim/generation.mutator.ts:30');

    // KernelSymbol stages stay null — symbolId is already their identity, and
    // the same fact never gets a second address.
    //
    // Duplicates in the list below are real shared usage, not noise:
    // cellVisitSwitch appears twice because strokeStart/strokeMove share the
    // appendStrokeVisit stage sequence; mergeGranularityBranches /
    // packGenerationResult / applyGenerationResult appear twice because
    // tickLoop/stepOnce share appendGeneration. Entry-position bare identifiers
    // (`pipeline(meta, fn)`) are detected the same as chain-link arguments —
    // runningPhaseSwitch / armStrokeState all have addresses. The Mutator-part
    // extraction contributes the apply* family (buffer-transition tail
    // effects that call no symbols) as named handlers too. `allStages`
    // recurses untracked branches, so play's `.spawn` launcher contributes a
    // SECOND `granularitySwitch` (the loop's self-divert re-arm is the first).
    // `stepGranularitySwitch` (step.ts's divert into stepOnce) appears once —
    // a single entry stage, no self-divert twin (stepOnce never diverts back).
    //
    // The interceptor/gate migration REMOVED 4 names from this list —
    // `granularityGateAndPayload` (renamed `knownGranularityGate`), `idlePhaseGate`,
    // `inStrokeGate`, `launchArmGate` — not because they lost their names, but
    // because they are no longer STAGE handlers at all: each now runs as a
    // framework gate BEFORE its guarded port symbol's handler is invoked, so
    // it has no address in any endpoint's stage tree. Their identity now
    // lives in `document.gates[].handler` instead (see the gates test above).
    // Each of their old pipe-entry positions is now an anonymous pass-through
    // closure (`pipe(closure)`, `handler: null`) — see the expectedKinds test
    // below for stepOnce/strokeMove's first-stage kind flip.
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
      'cellVisitSwitch',
      'cellVisitSwitch',
      'granularitySwitch',
      'granularitySwitch',
      'loadedSettingsSwitch',
      'mergeGranularityBranches',
      'mergeGranularityBranches',
      'packGenerationResult',
      'packGenerationResult',
      'packRandomizeResult',
      'runningPhaseSwitch',
      'sleepForSpeed',
      'stepGranularitySwitch',
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
    // tick's abort lives in the body of the cross-file helper
    // tickLoopPipeFor (picked up by helper following): runningPhaseSwitch is
    // still an in-pipe Switch (unaffected by the gate migration — it decides
    // AND self-terminates the loop, which a pre-handler veto cannot express).
    // stepOnce's OWN abort is gone: idlePhaseGate migrated to a framework gate
    // guarding `Circuit.Sim.step` — it runs before stepOnce's own stage tree
    // even starts, so stepOnce's `emittableVerbs` is now `[]` (nothing left
    // inside appendGeneration's own sequence emits a non-next verb).
    // Mechanical evidence that a gate is invisible to the STAGE-TREE
    // aggregation by construction — its verdicts are a different index
    // section entirely (`document.gates`), not folded into any endpoint.
    expect(byKey.get('Circuit.Sim.tickLoop')).toEqual(['abort']);
    expect(byKey.get('Circuit.Sim.stepOnce')).toEqual([]);
    // stroke's abort (outside-the-board / same cell) and divert (to togglePipe)
    // live inside the shared appendStrokeVisit stages (cellVisitSwitch, a named
    // function). Even in a named handler's body, divert alone is excluded from
    // emittableVerbs — divertsTo/symbolId already hold that edge's address
    // (avoiding double counting). abort has no such alternate channel, so it is
    // counted: strokeStart picks up cellVisitSwitch's abort → ['abort'];
    // strokeMove's abort ALSO stays ['abort'] — cellVisitSwitch is still an
    // in-pipe Switch (it diverts on success, a routing verb a gate cannot
    // express), but the OTHER source it used to have — its own entry gate
    // (inStrokeGate) — migrated out to guard:stroke.active and no longer
    // contributes here; cellVisitSwitch alone is enough to keep the value.
    expect(byKey.get('Circuit.Sim.strokeStart')).toEqual(['abort']);
    expect(byKey.get('Circuit.Sim.strokeMove')).toEqual(['abort']);
    // Unknown-value gate migrated to guard:settings.knownGranularity (a
    // framework gate, invisible to the stage tree — see stepOnce's own
    // comment above), so setGranularity's own emittableVerbs is now `[]`.
    expect(byKey.get('Circuit.Settings.setGranularity')).toEqual([]);
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
    // Root/entry stages that are STILL in-pipe Switch parts (bare identifiers
    // — mergeGranularityBranches/packGenerationResult/applyGenerationResult/
    // sleepForSpeed/granularitySwitch/cellVisitSwitch/armStrokeState/
    // runningPhaseSwitch) mint the `(function)` operand; the two remaining
    // inline-arrow assembly stages per chain stay `(closure)` (kernel-introspect
    // StageKind symbol/function/closure operand split).
    //
    // stepOnce's and strokeMove's own FIRST stage flips from `(function)` to
    // `(closure)` here — the interceptor/gate migration: idlePhaseGate /
    // inStrokeGate used to be THIS stage (a named bare-identifier entry gate);
    // now each is a framework gate guarding its port symbol from outside the
    // pipe entirely, so this pipe's own entry is a minimal anonymous
    // pass-through (`(_kernel, payload) => next(...)`, `handler: null`).
    // tickLoop/strokeStart are untouched — their own entry stages
    // (runningPhaseSwitch / armStrokeState) are not part of this migration.
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
        'pipe(closure)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'effect(function)',
      ],
      'Circuit.Sim.strokeStart': ['pipe(function)', 'pipe(closure)', 'pipe(symbol)', 'pipe(function)'],
      'Circuit.Sim.strokeMove': ['pipe(closure)', 'pipe(closure)', 'pipe(symbol)', 'pipe(function)'],
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

  it('named-mutation vocabulary (StateAccessEntry.via) is a genuine soft-null, no longer reported since schema v12', () => {
    // All 20 catalogued-pipe buffer.mutate sites are object-literal spread
    // rebuilds of the `(state) => ({ ...state, field: value })` shape, not
    // named method calls — via at 0/20 is the honest current state. The scope
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

    // schema v12: namedMutationVia is reported only when SOME state declares a
    // mutating-method vocabulary (mutatingMethods non-empty) or a via actually
    // resolved (resolvedViaCount > 0). This app's Contract states (Grid/Sim/
    // Stats) declare ZERO mutating methods and resolve ZERO via calls, so a
    // 0/N via count here is the expected shape for "no vocabulary exists at
    // all", not a coverage gap — the entry is suppressed.
    const summary = (document.unresolved ?? []).find((u) => u.kind === 'namedMutationVia');
    expect(summary).toBeUndefined();

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

  it('accounts for every unresolved entry: the true-unknown floor is zero (schema v12)', () => {
    // Both former occupants of this ledger (stateDeclaration for
    // KernelErrorState, namedMutationVia for the 0-method Contract states)
    // were classification mistakes, not genuine unknowns — each borrowed the
    // `unresolved` slot for an already-understood fact:
    //   stateDeclaration  — KernelErrorState is framework-injected
    //                       (origin: 'framework'), not an app state whose
    //                       declaration this scan failed to find; schema v12
    //                       gives it its own `origin` field instead of
    //                       riding the unresolved ledger.
    //   namedMutationVia  — this app declares ZERO mutating-method vocabulary
    //                       (Grid/Sim/Stats are plain readonly-field data
    //                       interfaces) and resolves ZERO via calls, so 0/N
    //                       is the expected shape for "no vocabulary exists
    //                       at all", not a coverage gap; schema v12
    //                       suppresses the report in exactly this case.
    // orphanEntry stays ZERO (dropped 1 → 0 in an earlier card): stepOnce,
    // the last real orphan (card B004D425), is resolved the SAME structural
    // way tickLoop's orphan was (card 4/4) — a distinct catalogued saga node
    // reached by an external `divertsTo` edge from a calling stage — but with
    // a DIFFERENT verb: `step` reaches `stepOnce` via `divert` (in-pipe,
    // on-bus, awaited by `kernel.run`), not play's detached `.spawn`, because
    // step's one-shot lap has no daemon guard of its own and must stay
    // serialized by the bus (see step.ts's doc comment).
    //
    // This floor is deliberately a hard 0, not "whatever an allowlist
    // permits": even a FUTURE known-and-accepted item (e.g. one added to
    // ASSEMBLED_WIRING_ISSUE_ALLOWLIST) should still break this test — the
    // point of a hard 0 is that `unresolved` is reserved for TRUE unknowns
    // only, so any new entry, however well-understood or allowlisted
    // elsewhere, forces a conscious decision (fix the classification, or
    // consciously decide it belongs here) instead of silently widening what
    // "unresolved" means. If this grows, look at the kind breakdown in the
    // diff first — a total alone cannot reveal offsetting changes.
    const unresolved = document.unresolved ?? [];
    expect(unresolved).toEqual([]);
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
    // switches (like the caller-side note of the outside-the-board/same-cell
    // switch — switches not yet named functions, or deliberately outside
    // selects-only) would require interpreting note wording, not just handler,
    // so it is deliberately not done here.
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

  it('parts: all 13 part files (switch 5 / emitter 2 / mutator 6) are indexed with usedBy — the subgraph as nodes', () => {
    // The test above (the handler.site reference floor) is "prevention of dead
    // part files" seen from the filesystem side. This one is the index itself
    // producing the parts section — the subgraph-as-nodes answer to "can this
    // fact be obtained without leaving the index?" (paving the index). The
    // expectation is pinned by count and breakdown (a completeness net must not
    // bless regressions — an expectation-lowering diff is the strongest
    // regression signal).
    //
    // The 5 switches: granularity / runningPhase / cellVisit / loadedSettings /
    // stepGranularity. Down from 9 (the interceptor/gate migration): launchArm /
    // idlePhase / inStroke / knownGranularity are no longer part files at all —
    // each is a `*.gate.ts` framework interceptor (declareGate/KernelBuilder.
    // guard), invisible to the switch/emitter/mutator topology because it runs
    // BEFORE its guarded port symbol's handler is even invoked (no stage-link
    // chain — see circuit/sim/launchArm.gate.ts's own doc comment). The 6
    // mutators: running (now pause only) / generation / randomize / toggleCell /
    // stroke / simState — unaffected by this migration. The bridge kind exists
    // as a slot but lifegame has 0 (the slot existing is itself meaningful — see
    // arch-circuit.md), so it does not appear in byKind.
    const parts = document.parts ?? [];
    const byKind = new Map<string, number>();
    for (const part of parts) byKind.set(part.kind, (byKind.get(part.kind) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual({ switch: 5, emitter: 2, mutator: 6 });
    expect(parts).toHaveLength(13);
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
    // (assembly.ts) — either path counts regardless of kind. running now holds
    // only `pause` (a command endpoint's declaration site); `play` graduated to
    // a saga when its launch became a `.spawn`, so it no longer references this
    // Mutator.
    expect(byId.get('running.mutator')?.usedBy).toEqual(['Circuit.Sim.pause']);
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
    // granularity.switch is now shared: the loop's self-divert re-arm
    // (tickLoop) AND play's `.spawn` launcher both reuse it (the same "read
    // granularity+board-size → divert into tickLoopPipeFor" hop).
    expect(byId.get('granularity.switch')?.usedBy).toEqual(['Circuit.Sim.play', 'Circuit.Sim.tickLoop']);
    // stepGranularity.switch: step's divert-target chooser (card B004D425) —
    // a ONE-SHOT hop into stepOnce, not a self-divert, so unlike
    // granularity.switch it has exactly one user.
    expect(byId.get('stepGranularity.switch')?.usedBy).toEqual(['Circuit.Sim.step']);
    // runningPhase.switch stays tickLoop-only: it is the LOOP's own entry
    // switch, reached from play only by divert (not in play's spawn stage
    // tree). Unlike launchArm/idlePhase (play's/step's own entry gates),
    // runningPhase guards the loop's OWN re-entry into itself on every lap
    // (self-divert) — a decision that also self-terminates the pipe, which a
    // pre-handler veto cannot express — so it stays a Switch, not a gate
    // migration candidate.
    expect(byId.get('runningPhase.switch')?.usedBy).toEqual(['Circuit.Sim.tickLoop']);
    expect(byId.get('randomize.emitter')?.usedBy).toEqual(['Circuit.Sim.randomize']);
    expect(byId.get('loadedSettings.switch')?.usedBy).toEqual(['Circuit.Settings.hydrateSettings']);
    // launchArm.switch / idlePhase.switch / inStroke.switch / knownGranularity.switch
    // are GONE from parts entirely (see byKind above) — moved to
    // circuit/sim/launchArm.gate.ts / idlePhase.gate.ts / inStroke.gate.ts /
    // circuit/settings/knownGranularity.gate.ts, indexed instead under
    // `document.gates` (see the dedicated gates test above), not `parts`.
    expect(byId.has('launchArm.switch')).toBe(false);
    expect(byId.has('idlePhase.switch')).toBe(false);
    expect(byId.has('inStroke.switch')).toBe(false);
    expect(byId.has('knownGranularity.switch')).toBe(false);
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
   * it to this allowlist (currently 4 entries).
   *
   * The interceptor/gate migration moved launchArm's write from a pipe-entry
   * Switch stage to a framework gate — the ALLOWLIST ENTRY follows the write
   * to its new site (`launchArm.gate.ts`, not `launchArm.switch.ts`), and the
   * test below now also walks `document.gates[].writesState` (phased 'gate'),
   * so the write stays visible to this net even though it left the stage tree
   * entirely (see the dedicated gates test above for the same fact from the
   * schema side).
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
      file: 'src/circuit/sim/launchArm.gate.ts',
      reason:
        "play's double-start guard: `wasIdle` must be read and the LoopState phase applied (→running) atomically " +
        '(no await between) or a re-entrant play could double-launch the loop — the write is inseparable from the ' +
        'launch/recover decision, the same exception shape as runningPhase.switch.ts. Migrated from a pipe-entry ' +
        'Switch to a framework gate (guard:loop.launchArm, guarding Circuit.Sim.play) — the write now surfaces via ' +
        "document.gates[].writesState (phase 'gate') rather than any endpoint's writesState. Declared in " +
        "launchArm.gate.ts's own doc comment.",
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

  it('writesState lives in *.mutator.ts or in a declared-exception *.switch.ts/*.gate.ts — errorSink excluded (CI floor)', () => {
    const fileOf = (site: string): string => site.replace(/:\d+$/, '');
    const allowlistedFiles = new Set(WRITES_STATE_MUTATOR_ALLOWLIST.map((e) => e.file));

    // `endpoint.writesState` is already the fully-attributed, recursively
    // collected list (fork branches included) — no separate stage-tree walk
    // needed here, unlike the note/handler checks above that inspect
    // StageEntry directly. `document.gates[].writesState` (schemaVersion 11)
    // is folded in alongside it: a gate write is real causality too — leaving
    // it out of this net just because it now lives in a different index
    // section would silently exempt it from the "mutator or declared
    // exception" discipline, not merely relocate the check.
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
    for (const gate of document.gates ?? []) {
      for (const write of gate.writesState) {
        const file = fileOf(write.site);
        const isMutator = file.endsWith('.mutator.ts');
        const isAllowlisted = allowlistedFiles.has(file);
        if (!isMutator && !isAllowlisted) {
          offenders.push({ key: gate.id, state: write.state, site: write.site });
        }
      }
    }
    expect(offenders, JSON.stringify(offenders, null, 2)).toEqual([]);

    // The debt list is actually alive (each allowlist entry is exercised by
    // real data) — confirm every entry is actually used by at least one
    // non-errorSink write (prevention of dead allowlist entries; the same
    // "never drop a miss silently" discipline as partUsage). Gate writes are
    // folded into the SAME usedFiles set as endpoint writes — one liveness
    // check, two sources — otherwise launchArm.gate.ts's entry would read as
    // dead the moment its write left the stage tree, even though the write is
    // still there, just relocated.
    const usedFiles = new Set([
      ...document.endpoints
        .flatMap((e) => e.writesState)
        .filter((w) => w.phase !== 'errorSink')
        .map((w) => fileOf(w.site)),
      ...(document.gates ?? []).flatMap((g) => g.writesState).map((w) => fileOf(w.site)),
    ]);
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
