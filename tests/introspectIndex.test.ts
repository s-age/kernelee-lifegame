// tests/introspectIndex.test.ts — verification of the IndexDocument's schema
// completeness + static-scan exhaustiveness.
//
// wiringCatalog.test.ts verifies only the runtime layer (projectWiringGraph +
// validateWiringGraph). This file runs kernelee-mcp-tools' runIntrospect against
// the real catalog (the same configuration as scripts/introspect.config.ts) and
// verifies the assembled IndexDocument (the post-static-scan shape, including
// inputType/drivenBy/readsState/writesState/verbEmissions/states/unresolved) —
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

/** Recursively enumerate `src/**\/*.switch.ts`, `src/**\/*.emitter.ts`, and `src/**\/*.bridge.ts` (relative paths, posix separators). */
function partFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return partFiles(path);
    return /\.(switch|emitter|bridge)\.ts$/.test(entry.name) ? [relative(repoRoot, path).split('\\').join('/')] : [];
  });
}

function allStages(stages: readonly StageEntry[]): StageEntry[] {
  return stages.flatMap((stage) => [
    stage,
    ...stage.branches.flatMap(allStages),
    ...stage.untrackedBranches.flatMap(allStages),
  ]);
}

/** The 3 `command`-kind endpoints — bound `portK` port members with no
 * `describePipe`d `Pipe` behind them, so `stages: []`/`inputType: null` are
 * honest for these specifically, not the "forgot to write it" case the
 * 11-catalog-pipe floor below polices. (`play` graduated to a catalogued
 * `'endpoint'` when its launch became a `.spawn` untracked fork branch — see
 * play.ts / wiringCatalog.ts. `step` graduated the same way when its launch
 * became an in-pipe `divert` — see step.ts / wiringCatalog.ts. Neither is a
 * bare command any longer. `Circuit.Faults.clearError` is the third — a
 * plain Mutator (circuit/faults/kernelError.mutator.ts) with no describePipe
 * entry, the same shape as pause/strokeEnd.) */
const COMMAND_KEYS = ['Circuit.Sim.pause', 'Circuit.Sim.strokeEnd', 'Circuit.Faults.clearError'];

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
    // The 11 describePipe catalog entries + the 3 command endpoints
    // (pause/strokeEnd/clearError — first-class-tokenized drive sites).
    expect(document.endpoints).toHaveLength(14);
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
    // tickLoop is never bound and never dispatched directly — it is reached
    // only by an external divert edge (play → tickLoop) — permanent
    // divertTarget. stepOnce no longer exists: the generation sequence it
    // used to name is now `Circuit.Sim.advanceGeneration`, a directly BOUND
    // portK member with its own describePipe entry — an ordinary 'endpoint',
    // not a divertTarget (see below).
    expect(byKey.get('Circuit.Sim.tickLoop')?.kind).toBe('divertTarget');
    for (const key of [
      'Circuit.Sim.play', // catalogued saga endpoint (its launch is a .spawn)
      'Circuit.Sim.step', // catalogued saga endpoint (its one stage is the advanceGeneration symbol — see step.ts)
      'Circuit.Sim.advanceGeneration', // catalogued saga endpoint (bound portK, referenced by tickLoop/step as a symbol — see advanceGeneration.ts)
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
    // pause/strokeEnd/clearError: bound portK members with no describePipe entry —
    // a THIRD kind, neither 'endpoint' (needs a catalogued Pipe) nor 'divertTarget'.
    for (const key of COMMAND_KEYS) {
      expect(byKey.get(key)?.kind, key).toBe('command');
    }
  });

  it('tickLoop is reached by play\'s .spawn divert edge (never run-launched)', () => {
    const tickLoop = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;

    // tickLoop: divertTarget, reached by play's detached `.spawn` launcher,
    // which diverts into the (single, module-constant) loop pipe via the
    // decisionless tickLoop.bridge.ts. So its incoming edge is a DIVERT edge
    // (divertedFrom includes the external referrer 'Circuit.Sim.play') — NOT
    // a `kernel.run` launch (the old launchTickLoop is gone). That external
    // referrer is exactly what resolves its former orphanEntry. tickLoop is
    // ALSO flow()-bound now (SimFlowKeys.tickLoop, like toggleCell) — but
    // `kind` is driven by `boundSymbolIds` (portK members), not `flow()`-bound
    // keys, so `kind` stays 'divertTarget' regardless.
    expect(tickLoop.kind).toBe('divertTarget');
    expect(tickLoop.divertedFrom).toContain('Circuit.Sim.play');
    expect(tickLoop.drivenBy).toEqual([]); // no drive site at all — reached ONLY by divert
  });

  it('advanceGeneration is reached by tickLoop/step as a SYMBOL-COMPOSITION edge — neither divert nor dispatch', () => {
    // The one-lap generation body that used to be `Circuit.Sim.stepOnce`
    // (reached by step's in-pipe `divert`) no longer exists as a separate
    // pipe at all: the sequence is now `Circuit.Sim.advanceGeneration`
    // (advanceGeneration.ts), a directly bound portK member with its own
    // describePipe entry — an ordinary 'endpoint', reached by tickLoop
    // (`.tap`, mid-pipe) and step (`pipeline(symbol)`, its whole pipe) as
    // symbol-composition edges, through `kernel.invoke` — never a divert
    // (divertedFrom stays empty) and never dispatched (its own port
    // description says so explicitly; drivenBy stays empty too). This third
    // reach path — "referenced as a symbol by another endpoint's own stage" —
    // is recovered via `document.symbols[].usedByStagesOf`, the same field
    // that already names diffStats' callers (see the shared-symbol test
    // below), not via divertedFrom/drivenBy.
    const advanceGeneration = document.endpoints.find((e) => e.key === 'Circuit.Sim.advanceGeneration')!;
    expect(advanceGeneration.kind).toBe('endpoint');
    expect(advanceGeneration.divertedFrom).toEqual([]);
    expect(advanceGeneration.drivenBy).toEqual([]);

    const symbol = document.symbols.find((s) => s.id === 'Circuit.Sim.advanceGeneration')!;
    expect(symbol.bound).toBe(true);
    expect(symbol.usedByStagesOf).toEqual(['Circuit.Sim.tickLoop', 'Circuit.Sim.step']);
  });

  it('every command endpoint (pause/strokeEnd/clearError) has a real drive site', () => {
    for (const key of COMMAND_KEYS) {
      const endpoint = document.endpoints.find((e) => e.key === key)!;
      expect(endpoint.drivenBy.length, `${key}: command endpoint with no drive site`).toBeGreaterThan(0);
      expect(endpoint.drivenBy.every((d) => d.mode === 'dispatch'), key).toBe(true);
    }
  });

  it('every endpoint reachable only by direct dispatch or symbol composition (no divertedFrom) has a real reach path', () => {
    // Two ways for a bound, non-divert 'endpoint' to be reached: dispatch
    // (drivenBy) or being composed as a SYMBOL by another endpoint's own
    // stage (`document.symbols[].usedByStagesOf` naming this endpoint's own
    // key). `Circuit.Sim.advanceGeneration` is the one endpoint that takes
    // the second path exclusively: its own port description says it is "not
    // a command intended for dispatch", so drivenBy is legitimately empty —
    // but tickLoop's `.tap` and step's `pipeline(symbol)` referencing it are
    // still a real, recoverable reach path, just not one drivenBy/divertedFrom
    // can name.
    const symbolByKey = new Map(document.symbols.map((s) => [s.id, s]));
    for (const endpoint of document.endpoints) {
      if (endpoint.kind === 'endpoint' && endpoint.divertedFrom.length === 0) {
        const reachedAsSymbol = (symbolByKey.get(endpoint.key)?.usedByStagesOf.length ?? 0) > 0;
        expect(
          endpoint.drivenBy.length > 0 || reachedAsSymbol,
          `${endpoint.key}: bound, non-divert endpoint with no drive site and no symbol-composition referrer`,
        ).toBe(true);
      }
    }
  });

  it('toggleCell: bound but in production only ever reached via strokeMove divert, never dispatched directly', () => {
    // Also evidence that the cross-package drivenBy detection does not
    // over-detect — dispatch(SimActions.toggleCell(...)) does not actually
    // exist anywhere, so drivenBy stays empty. strokeStart no longer diverts
    // to toggleCell directly (owner-decided 2026-07-19): it hops into the
    // shared strokeMovePipe instead (strokeMove.bridge.ts), and that pipe's
    // own cellVisitSwitch is the only diverter into toggleCell now.
    const toggleCell = document.endpoints.find((e) => e.key === 'Circuit.Sim.toggleCell');
    expect(toggleCell?.divertedFrom).toEqual(['Circuit.Sim.strokeMove']);
    expect(toggleCell?.drivenBy).toEqual([]);

    // strokeMove itself is now also a divert target — strokeStart's fixed
    // hop into the shared visit-interpretation pipe (strokeMove.bridge.ts).
    const strokeMove = document.endpoints.find((e) => e.key === 'Circuit.Sim.strokeMove');
    expect(strokeMove?.divertedFrom).toEqual(['Circuit.Sim.strokeStart']);
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
    // The currently-promoted entries (pause/strokeEnd/clearError — COMMAND_KEYS)
    // no longer linger as unlistedBoundSymbol (positive evidence the
    // suppression works). play/step graduated further still, out of the
    // promotion mechanism entirely, into catalogued 'endpoint's with their own
    // describePipe entry — so the historical count of "promoted at some point"
    // was 4 (play/pause/step/strokeEnd), while COMMAND_KEYS today names only
    // the 3 still relying on promotion. Neither set is in the ASSEMBLED list,
    // so the exact match above already implies this, but state it explicitly.
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

  it('KernelErrorState is tokenized: origin:framework + declaration:null (not unresolved) / read (useKernelError) / report stays a composition-root onError policy (unscanned), clear is a command+Mutator on the graph', () => {
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
    // The exact line shifts with ErrorBanner's own edits (dismiss button, useDispatch import) — re-pin from a real run, not by hand.
    expect(kes.readBy.map((r) => r.site)).toEqual(['src/presentation/ErrorBanner.tsx:14']);

    // Write: the FAILURE report stays exactly where the detached-fork migration
    // (card 4/4) left it. The KernelErrorState write used to be app-pipe code —
    // the hand-rolled `settleTickLoopFault` Mutator that `play`'s
    // `void kernel.run(...).catch()` delegated to. Now that `play` launches the
    // loop as a `.spawn` untracked fork branch, a branch fault routes to the
    // framework errorSink, and the REPORTING write lives in the composition
    // root's `onError` policy (driver/wiring.ts's `loopFaultSink`) — framework-
    // boundary infrastructure, not a catalogued pipe or command handler, so the
    // static scan attributes no endpoint to it.
    //
    // CLEARING is a different operation with a different home: it is a
    // display-driven APP action (Circuit.Faults.clearError), so it DOES land on
    // the wiring graph — a command endpoint whose Mutator
    // (circuit/faults/kernelError.mutator.ts) writes KernelErrorState. This is
    // the one and only KernelErrorState write the app's own wiring graph now
    // shows; the report itself is still invisible to it, as before.
    const kesWrites = document.endpoints.flatMap((e) =>
      e.writesState.filter((w) => w.state === 'KernelErrorState').map((w) => ({ key: e.key, ...w })),
    );
    expect(kesWrites).toEqual([
      {
        key: 'Circuit.Faults.clearError',
        state: 'KernelErrorState',
        site: 'src/circuit/faults/kernelError.mutator.ts:22',
        attribution: 'function',
        phase: 'command',
        via: null,
      },
    ]);
    // writtenBy is the presentation-write scan (the useKernel() escape hatch) —
    // dismiss goes through dispatch, not a direct buffer.mutate from a view, so
    // this stays [] unchanged.
    expect(kes.writtenBy).toEqual([]); // and no presentation write either
  });

  it('representative state-graph values hold: GridState/StatsState writers and presentation readers', () => {
    // advanceGeneration is the sole GridState/StatsState writer for the
    // generation sequence now — its `.effect` lives directly under its OWN
    // endpoint's scope (advanceGeneration.ts), not attributed transitively to
    // tickLoop/step any more. Before this card, tickLoop and stepOnce each
    // carried their OWN COPY of the appendGeneration stage sequence (a
    // construction-time DRY function, not a graph edge), so the static scan
    // found the write duplicated under BOTH endpoints. Now the sequence is
    // ONE pipe bound to its own port symbol, and tickLoop/step reference it
    // as a symbol-composition edge (`.tap`/`pipeline(symbol)`, through
    // `kernel.invoke`) — the static scan's writesState attribution does not
    // cross a symbol edge (a symbol stage's downstream effects belong to
    // the SYMBOL's own endpoint, never folded back into the composing
    // endpoint's writesState), so tickLoop/step's own writesState no longer
    // include GridState/StatsState. This is a real topology change (the write
    // has exactly one owning endpoint now), not an attribution regression —
    // `Circuit.Sim.advanceGeneration` also matches diffStats.usedByStagesOf
    // (the shared-symbol test below).
    const gridWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'GridState')).map((e) => e.key),
    );
    expect(gridWriters).toEqual(
      new Set([
        'Circuit.Sim.advanceGeneration',
        'Circuit.Sim.randomize',
        'Circuit.Sim.toggleCell',
      ]),
    );

    const statsWriters = new Set(
      document.endpoints.filter((e) => e.writesState.some((w) => w.state === 'StatsState')).map((e) => e.key),
    );
    expect(statsWriters).toEqual(
      new Set([
        'Circuit.Sim.advanceGeneration',
        'Circuit.Sim.randomize',
        'Circuit.Sim.toggleCell',
      ]),
    );

    // That write lives in advanceGenerationPipe's own tail `.effect`, so the
    // phase is 'effect'.
    const advanceGeneration = document.endpoints.find((e) => e.key === 'Circuit.Sim.advanceGeneration')!;
    expect(advanceGeneration.writesState.find((w) => w.state === 'GridState')?.phase).toBe('effect');

    // play/step's OWN writesState is empty — play's entry stage is a bare
    // Bridge handler that calls no symbol and touches no buffer; step's one
    // stage IS the advanceGeneration symbol, and (per the comment above) that
    // downstream write belongs to advanceGeneration's own endpoint, not
    // step's. launchArmGate's own LoopState arm write still surfaces via
    // `document.gates[].writesState` (phase 'gate'), verified in its own test
    // below — unaffected by this card. tickLoop's OWN runningPhaseSwitch write
    // still shows with phase 'stage' (it is tickLoop's own top-level entry
    // stage, unaffected by the symbol-composition change to its OTHER stage).
    const play = document.endpoints.find((e) => e.key === 'Circuit.Sim.play')!;
    expect(play.writesState).toEqual([]);
    const step = document.endpoints.find((e) => e.key === 'Circuit.Sim.step')!;
    expect(step.writesState).toEqual([]);
    const tickLoopOwn = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;
    expect(tickLoopOwn.writesState.filter((w) => w.state === 'LoopState').map((w) => w.phase)).toEqual(['stage']);

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
    // diffStats is called from exactly ONE place now (advanceGenerationPipe's
    // own stats-line fork branch) — advanceGeneration replaces BOTH
    // tickLoop and stepOnce in this list, because the generation sequence
    // that calls it lives in exactly one endpoint's own stage tree now, not
    // duplicated across two callers.
    const diffStats = symbols.find((s) => s.id === 'Compute.Life.diffStats');
    expect(diffStats?.usedByStagesOf).toEqual([
      'Circuit.Sim.advanceGeneration',
      'Circuit.Sim.randomize',
      'Circuit.Sim.toggleCell',
    ]);
    const save = symbols.find((s) => s.id === 'Infrastructure.Settings.save');
    expect(save?.usedByStagesOf).toEqual(['Circuit.Settings.setSpeed', 'Circuit.Settings.setGranularity']);
    // Circuit.Sim.advanceGeneration is ITSELF a shared symbol now — the first
    // circuit-to-circuit symbol-composition edge in this app, called from
    // both tickLoop (.tap) and step (pipeline(symbol)).
    const advanceGeneration = symbols.find((s) => s.id === 'Circuit.Sim.advanceGeneration');
    expect(advanceGeneration?.usedByStagesOf).toEqual(['Circuit.Sim.tickLoop', 'Circuit.Sim.step']);
    expect(symbols.every((s) => s.bound)).toBe(true);
  });

  it('symbol-composition edges among endpoints form a DAG (cycles are the divert tier\'s exclusive job)', () => {
    // Circuit ports can now compose OTHER circuit ports as ordinary stages
    // (`.tap(sym)` / `.pipe(sym)` / `.fork(sym)`) — the same chokepoint
    // (`kernel.invoke`) Compute/Infrastructure symbol stages already used.
    // `Circuit.Sim.advanceGeneration`, referenced by tickLoop (`.tap`) and
    // step (`pipeline(symbol)`), is the first live example. A
    // symbol-composition edge is a STAGE, not a divert: kernelee's own
    // iterative `runStages` gives O(1)-stack safety to a self-DIVERTING loop,
    // but nothing gives that same guarantee to a symbol edge — two endpoints
    // whose stages referenced each other's symbol would recurse through
    // `kernel.invoke` at RUNTIME with no iteration trick to catch it. This
    // floor is the static backstop: walk every endpoint's own stage tree,
    // collect symbolId edges that target ANOTHER CATALOGUED ENDPOINT
    // (Compute/Infrastructure symbols are leaves, never endpoints, so they
    // can never appear as a cycle node here), and assert the resulting graph
    // has no cycle — including a trivial self-loop. Divert edges
    // (`divertsTo`/`divertedFrom`) are deliberately EXCLUDED from this graph:
    // a cycle THERE is the whole point of a self-divert loop (tickLoop's own
    // reentry), and the divert tier is what makes that safe — cycles are its
    // exclusive job, never a symbol-composition edge's.
    const endpointKeys = new Set(document.endpoints.map((e) => e.key));
    const edges = new Map<string, Set<string>>();
    for (const endpoint of document.endpoints) {
      const targets = new Set<string>();
      for (const stage of allStages(endpoint.stages)) {
        if (stage.symbolId !== null && endpointKeys.has(stage.symbolId)) {
          targets.add(stage.symbolId);
        }
      }
      if (targets.size > 0) edges.set(endpoint.key, targets);
    }

    // Never let zero subjects make this floor vacuously true — the real
    // topology must actually exercise it.
    expect(edges.size).toBeGreaterThan(0);
    expect(edges.get('Circuit.Sim.tickLoop')).toEqual(new Set(['Circuit.Sim.advanceGeneration']));
    expect(edges.get('Circuit.Sim.step')).toEqual(new Set(['Circuit.Sim.advanceGeneration']));

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    const path: string[] = [];
    let cycleDescription: string | null = null;
    const visit = (node: string): boolean => {
      color.set(node, GRAY);
      path.push(node);
      for (const next of edges.get(node) ?? []) {
        const state = color.get(next) ?? WHITE;
        if (state === GRAY) {
          cycleDescription = [...path, next].join(' -> ');
          return true;
        }
        if (state === WHITE && visit(next)) return true;
      }
      path.pop();
      color.set(node, BLACK);
      return false;
    };
    let hasCycle = false;
    for (const key of edges.keys()) {
      if ((color.get(key) ?? WHITE) === WHITE && visit(key)) {
        hasCycle = true;
        break;
      }
    }
    expect(hasCycle, `symbol-composition cycle detected: ${cycleDescription}`).toBe(false);
  });

  it('declares its own current coverage ceiling honestly (not an aspirational value)', () => {
    // v14: per-stage/per-gate abort/fail recovery via identifier resolution,
    // replacing the retired endpoint-level EndpointEntry.emittableVerbs.
    expect(document.meta.schemaVersion).toBe(14);
    // The honest current reach on the TS side — symbol-usage coverage stops at
    // the lower bound of explicit-symbolId stages + static call-site scanning
    // (not complete). It should flip to true only when coverage is actually
    // complete; if the value drifts, this test catches it.
    expect(document.meta.symbolUsage.complete).toBe(false);
    expect(document.meta.declarations?.coverage).toContain('ts-morph static scan');
    expect(document.meta.workingTreeHash).not.toBeNull();
  });

  it('the granularity value→branch-count mapping sinks into Compute (intentionally non-symbolized) — valueSelectors/branchSelector are honestly empty', () => {
    // Until fork(symbol), the granularity→branch-count table lived in
    // circuit (circuit/sim's deleted branch-factory module) as a
    // module-scope literal table + a function directly returning
    // `TABLE[param](...)` — the one shape
    // kernel-introspect tokenizes as `valueSelectors`, giving the fork a
    // `branchSelector` correlation edge. fork(symbol) replaces that whole
    // authoring pattern: the range list is now produced by a Compute symbol
    // (LifePort.partitionRanges → compute/life.ts's `rowMajorRanges`, a plain
    // `switch`, never a table), and Compute internals are DELIBERATELY
    // non-symbolized (this app's own doctrine — only the port's Payload/Return
    // DTO is contract-visible, never its internal branching). So the fact
    // this test used to pin (a table-shaped selector reachable from a fork)
    // no longer exists anywhere in this app — the two remaining
    // `fork(branches)` stages (the board-line/stats-line two-line forks) are
    // both fixed-arity, inline, with no chooser at all.
    expect(document.valueSelectors ?? []).toEqual([]);
    for (const endpoint of document.endpoints) {
      for (const stage of allStages(endpoint.stages)) {
        expect(stage.branchSelector, `${endpoint.key}: unexpected branchSelector`).toBeNull();
      }
    }
  });

  it("gives named stage handlers an address — tickLoop's sleep effect and advanceGeneration's own write effect are each distinguishable", () => {
    // The motivation itself: without named handlers, an index reader could not
    // tell two same-kind stages apart. Before this card, tickLoop carried
    // BOTH effects itself (sleepForSpeed AND applyGenerationResult, inlined by
    // the appendGeneration DRY function into its own stage tree); now the
    // generation write lives solely under its own endpoint
    // (Circuit.Sim.advanceGeneration), reached from tickLoop as a
    // symbol-composition edge (`tap(symbol)`) rather than an inlined stage —
    // so the two effects live on two DIFFERENT endpoints' stage trees, each
    // still individually addressable via a bare identifier (sleepForSpeed /
    // applyGenerationResult).
    const tickLoop = document.endpoints.find((e) => e.key === 'Circuit.Sim.tickLoop')!;
    const advanceGeneration = document.endpoints.find((e) => e.key === 'Circuit.Sim.advanceGeneration')!;

    const tickLoopEffects = allStages(tickLoop.stages).filter((s) => s.kind === 'effect(function)');
    expect(tickLoopEffects).toHaveLength(1);
    expect(tickLoopEffects[0].handler!.functionName).toBe('sleepForSpeed');
    // site is where the body lives (the grep target), not the wiring site.
    expect(tickLoopEffects[0].handler!.site).toBe('src/circuit/sim/tickLoop.ts:32');

    const advanceGenerationEffects = allStages(advanceGeneration.stages).filter((s) => s.kind === 'effect(function)');
    expect(advanceGenerationEffects).toHaveLength(1);
    expect(advanceGenerationEffects[0].handler!.functionName).toBe('applyGenerationResult');
    expect(advanceGenerationEffects[0].handler!.site).toBe('src/circuit/sim/advanceGeneration.mutator.ts:30');

    // tickLoop's OWN mid-pipe reference to advanceGeneration is a
    // tap(symbol) stage — symbolId is already its identity, so it carries no
    // handler address (a stage cannot be both `(symbol)` and named).
    const tap = tickLoop.stages.find((s) => s.kind === 'tap(symbol)')!;
    expect(tap.symbolId).toBe('Circuit.Sim.advanceGeneration');
    expect(tap.handler).toBeNull();

    // KernelSymbol stages stay null — symbolId is already their identity, and
    // the same fact never gets a second address.
    //
    // Duplicates in the list below are real shared usage, not noise:
    // mergeGranularityBranches / packGenerationResult / applyGenerationResult
    // now appear ONLY ONCE EACH — they live solely inside advanceGenerationPipe's
    // own stage tree (advanceGeneration.ts), no longer duplicated across
    // tickLoop/stepOnce (stepOnce is gone; tickLoop/step reference the whole
    // sequence as a symbol instead of inlining a copy of it). cellVisitSwitch
    // similarly appears only ONCE — it lives solely in strokeMovePipe
    // (stroke.ts), the single flow-bound pipe both stroke entries reach
    // (strokeMove by dispatch, strokeStart by divert through
    // strokeMove.bridge.ts); the former `appendStrokeVisit` appender that
    // duplicated it into both endpoints' own stage trees is deleted
    // (owner-decided 2026-07-19 — sharing is pipeline-value composition, not
    // a helper function). Entry-position bare identifiers
    // (`pipeline(meta, fn)`) are detected the same as chain-link arguments —
    // runningPhaseSwitch / armStrokeState all have addresses. The Mutator-part
    // extraction contributes the apply* family (buffer-transition tail
    // effects that call no symbols) as named handlers too. `allStages`
    // recurses untracked branches, so play's `.spawn` launcher contributes a
    // SECOND `tickLoopBridge` (the loop's own self-divert reentry is the
    // first) — reused at both call sites exactly the way `granularitySwitch`
    // used to be (now deleted). `strokeMoveBridge` (stroke.ts's
    // strokeStartPipe divert into strokeMovePipe) appears once — a one-shot
    // connector, not a self-divert.
    //
    // The interceptor/gate migration REMOVED 4 names from this list —
    // `granularityGateAndPayload` (renamed `knownGranularityGate`), `idlePhaseGate`,
    // `inStrokeGate`, `launchArmGate` — not because they lost their names, but
    // because they are no longer STAGE handlers at all: each now runs as a
    // framework gate BEFORE its guarded port symbol's handler is invoked, so
    // it has no address in any endpoint's stage tree. Their identity now
    // lives in `document.gates[].handler` instead (see the gates test above).
    //
    // This card's own fallout (`stepOnce.bridge.ts` deleted, its
    // `stepOnceBridge` handler gone — step's hop is now a bare
    // `pipeline(symbol)` with no handler of its own; `mergeGranularityBranches`
    // / `packGenerationResult` / `applyGenerationResult` each drop from 2
    // occurrences to 1, since advanceGeneration owns them exclusively now):
    // net -4 from the previous count.
    const named = document.endpoints.flatMap((e) => allStages(e.stages)).filter((s) => s.handler !== null);
    expect(named.map((s) => s.handler!.functionName).sort()).toEqual([
      'applyGenerationResult',
      'applyGranularity',
      'applyHydratedSettings',
      'applyRandomizeResult',
      'applySpeed',
      'applyToggleStats',
      'armStrokeState',
      'cellVisitSwitch',
      'loadedSettingsSwitch',
      'mergeGranularityBranches',
      'packGenerationResult',
      'packRandomizeResult',
      'runningPhaseSwitch',
      'sleepForSpeed',
      'strokeMoveBridge',
      'tickLoopBridge',
      'tickLoopBridge',
    ]);
    expect(named.every((s) => s.symbolId === null)).toBe(true);
  });

  it('recovers each abort call\'s own per-stage verbEmissions, with desc, by identifier resolution (schema v14)', () => {
    // Replaces the retired v3 `EndpointEntry.emittableVerbs` (endpoint-level,
    // shape-based, no desc) with the per-STAGE recovery: `StageEntry.
    // verbEmissions` — `null` = not scanned, `[]` = scanned clean, an entry
    // per identifier-resolved `abort`/`fail` call this ONE stage's own
    // handler (inline or named) contains. Every non-empty entry across the
    // whole app is `abort` with a real `desc` (no bare `fail(` anywhere, and
    // every one of the 8 real abort sites was given a desc).
    const byKey = new Map(document.endpoints.map((e) => [e.key, e]));
    const emissionsOf = (key: string) =>
      allStages(byKey.get(key)!.stages).flatMap((s) => s.verbEmissions ?? []);
    for (const endpoint of document.endpoints) {
      for (const emission of allStages(endpoint.stages).flatMap((s) => s.verbEmissions ?? [])) {
        expect(emission.verb, endpoint.key).toBe('abort'); // no fail( anywhere in the real app
        expect(typeof emission.desc, endpoint.key).toBe('string'); // every real abort site was given a desc
      }
    }

    // tick's abort lives in the body of its OWN entry stage
    // (runningPhaseSwitch — an in-pipe Switch, unaffected by the gate
    // migration: it decides AND self-terminates the loop, which a
    // pre-handler veto cannot express). advanceGeneration's own stages carry
    // NO verbEmissions at all — it is a straight-line sequence (snapshot →
    // partition → fork(symbol) → join → fork(board/stats) → write) with no
    // Switch or gate of its own; tickLoop's `.tap` reference to it does not
    // fold advanceGeneration's (empty) emissions back into tickLoop's own
    // stage tree either way — per-stage attribution never crosses a
    // symbol-composition edge, the same way it never crossed the old
    // builder-helper seam for shared writes (see the state-graph test
    // above). Mechanical evidence that a gate is invisible to the
    // STAGE-TREE aggregation by construction — its own verdict is a
    // different index section entirely (`document.gates[].verbEmissions`),
    // never folded into any endpoint's own stages.
    expect(emissionsOf('Circuit.Sim.tickLoop')).toEqual([
      { verb: 'abort', desc: 'stop settled — phase lowered to idle', site: expect.stringMatching(/runningPhase\.switch\.ts:\d+$/) },
    ]);
    expect(emissionsOf('Circuit.Sim.advanceGeneration')).toEqual([]);
    expect(emissionsOf('Circuit.Sim.step')).toEqual([]); // step's one stage IS the advanceGeneration symbol — no verb of its own

    // stroke's abort (outside-the-board / same cell) lives inside
    // cellVisitSwitch (a named function) — since owner-decided 2026-07-19,
    // that stage exists ONLY in strokeMovePipe (stroke.ts): the former
    // `appendStrokeVisit` appender that duplicated it into both endpoints'
    // own stage trees is deleted, so strokeMove's own stage tree picks up
    // BOTH of cellVisitSwitch's aborts, each with its own desc (moved from
    // the trailing `// outside the board` / `// suppress same-cell repeats`
    // comments). `divert` is never verbEmissions data at all (schema v14 —
    // it is validated for divertsTo completeness, never stored), so
    // cellVisitSwitch's own `diverts.toggle(cell)` call contributes nothing
    // here regardless. strokeStart's own stage tree carries NO verbEmissions
    // — its two stages (armStrokeState, strokeMoveBridge) have no abort of
    // their own; strokeStart only REACHES cellVisitSwitch's aborts across
    // the divert edge into strokeMovePipe, which per-stage attribution does
    // not follow (a divert hop is a separate catalogued pipe, not spliced
    // into the diverting endpoint's own chain).
    expect(emissionsOf('Circuit.Sim.strokeStart')).toEqual([]);
    expect(emissionsOf('Circuit.Sim.strokeMove')).toEqual([
      { verb: 'abort', desc: 'outside the board', site: expect.stringMatching(/cellVisit\.switch\.ts:\d+$/) },
      { verb: 'abort', desc: 'suppress same-cell repeats', site: expect.stringMatching(/cellVisit\.switch\.ts:\d+$/) },
    ]);

    // Unknown-value gate is a framework gate (guard:settings.knownGranularity,
    // invisible to the stage tree), so setGranularity's own stage tree
    // carries no verbEmissions. hydrateSettings still aborts in-pipe
    // (loadedSettingsSwitch — a RESULT-dependent decision).
    expect(emissionsOf('Circuit.Settings.setGranularity')).toEqual([]);
    expect(emissionsOf('Circuit.Settings.hydrateSettings')).toEqual([
      { verb: 'abort', desc: 'missing or corrupt data — keep defaults', site: expect.stringMatching(/loadedSettings\.switch\.ts:\d+$/) },
    ]);

    // The 4 framework gates each carry their own abort, with desc, on
    // GateEntry.verbEmissions — never folded into any endpoint's stages.
    const gateEmissions = new Map((document.gates ?? []).map((g) => [g.id, g.verbEmissions ?? []]));
    expect(gateEmissions.get('guard:loop.launchArm')).toEqual([
      { verb: 'abort', desc: 'already active — no double start, in-flight loop reused', site: expect.stringMatching(/launchArm\.gate\.ts:\d+$/) },
    ]);
    expect(gateEmissions.get('guard:loop.idle')).toEqual([
      { verb: 'abort', desc: 'not idle — step ignored', site: expect.stringMatching(/idlePhase\.gate\.ts:\d+$/) },
    ]);
    expect(gateEmissions.get('guard:stroke.active')).toEqual([
      { verb: 'abort', desc: 'no active stroke — ignored', site: expect.stringMatching(/inStroke\.gate\.ts:\d+$/) },
    ]);
    expect(gateEmissions.get('guard:settings.knownGranularity')).toEqual([
      { verb: 'abort', desc: 'unknown granularity value — ignored', site: expect.stringMatching(/knownGranularity\.gate\.ts:\d+$/) },
    ]);

    // Completeness: the tick loop's self-divert (tickLoopBridge's
    // `diverts.tickLoop(undefined)`) is a typed-channel property call, never
    // a direct identifier `divert(...)` — no `undeclaredDivert`/
    // `unattributedVerbEmission` anywhere (the hard 0 floor above already
    // proves this; restated here for locality with this test's own claims).
    expect((document.unresolved ?? []).filter((u) => u.kind === 'unattributedVerbEmission' || u.kind === 'undeclaredDivert')).toEqual([]);
  });

  it('recovers per-stage flows across flat chains and a symbol-composition edge, kind-verified', () => {
    const byKey = new Map(document.endpoints.map((e) => [e.key, e]));

    // Before this card, tickLoop/stepOnce were assembled by the cross-file
    // builder helper appendGeneration — a construction-time DRY function that
    // copied its stages into BOTH pipes, and the chain-splicer had to
    // penetrate that seam to recover flows for the copied stages. That seam
    // is gone: the generation sequence is now ONE pipe
    // (`advanceGenerationPipe`, advanceGeneration.ts) bound to its own port
    // symbol, and tickLoop/step reference it as an ordinary
    // `tap(symbol)`/`pipe(symbol)` stage — no splicing needed, because there
    // is no longer a second copy to splice into. Each endpoint below is
    // simply its own flat chain. stroke (strokeStart / strokeMove) is NOT a
    // builder-helper seam either (owner-decided 2026-07-19, unrelated to this
    // card): the former `appendStrokeVisit` appender is deleted, and sharing
    // is expressed as pipeline-value composition instead — one flow-bound
    // pipe (`strokeMovePipe`) entered by divert (`strokeMove.bridge.ts`).
    //
    // Root/entry stages that are bare identifiers (mergeGranularityBranches/
    // packGenerationResult/applyGenerationResult/sleepForSpeed/tickLoopBridge/
    // strokeMoveBridge/cellVisitSwitch/armStrokeState/runningPhaseSwitch) mint
    // the `(function)` operand; the anonymous inline-arrow assembly stages
    // per chain stay `(closure)` (kernel-introspect StageKind
    // symbol/function/closure operand split); a stage referencing a bound
    // port symbol (Compute.Life.partitionRanges, Circuit.Sim.advanceGeneration)
    // mints `(symbol)`.
    //
    // step's own single stage is `pipe(symbol)` — `pipeline(SimPort.
    // advanceGeneration)`, the symbol-entry form: the symbol IS the whole
    // pipe, so there is no anonymous entry stage at all (unlike stepOnce's
    // former minimal pass-through, which existed only because idlePhaseGate's
    // migration left its old entry-gate position empty — that whole pipe, and
    // that whole migration remnant, is gone with it).
    const expectedKinds: Record<string, string[]> = {
      'Circuit.Sim.tickLoop': ['pipe(function)', 'tap(symbol)', 'effect(function)', 'pipe(function)'],
      'Circuit.Sim.step': ['pipe(symbol)'],
      'Circuit.Sim.advanceGeneration': [
        'pipe(closure)',
        'pipe(closure)',
        'pipe(symbol)',
        'fork(symbol)',
        'map(function)',
        'pipe(closure)',
        'fork(branches)',
        'map(function)',
        'effect(function)',
      ],
      // strokeStart: armStrokeState (entry) → strokeMoveBridge (fixed hop
      // into strokeMove). Just 2 stages now — no shared-tail duplication.
      'Circuit.Sim.strokeStart': ['pipe(function)', 'pipe(function)'],
      // strokeMove: assemble HitCellInput (closure, now the entry) →
      // LifePort.hitCell (symbol) → cellVisitSwitch (function). 3 stages —
      // the old anonymous pass-through entry (the inStrokeGate migration
      // remnant) is gone; this pipe simply opens on its first real stage.
      'Circuit.Sim.strokeMove': ['pipe(closure)', 'pipe(symbol)', 'pipe(function)'],
    };
    for (const [key, kinds] of Object.entries(expectedKinds)) {
      const stages = byKey.get(key)?.stages ?? [];
      expect(stages.map((s) => s.kind), key).toEqual(kinds);
      expect(stages.every((s) => s.flows !== null), key).toBe(true);
    }
    // advanceGenerationPipe's tail .effect writes the board — the cursor is
    // the generation result (cells/stats). It is now on advanceGeneration's
    // OWN stage list (index 8, its last stage), not tickLoop's.
    const advanceEffect = byKey.get('Circuit.Sim.advanceGeneration')?.stages[8];
    expect(advanceEffect?.kind).toBe('effect(function)');
    expect(advanceEffect?.flows).toContain('cells');

    // tickLoop's own tap(symbol) stage carries the flows fact too — the
    // cursor stays `void` across it (a tap forwards its input unchanged), so
    // this is the one place `flows` is expected to be the trivial `'void'`,
    // not a miss.
    const tickTap = byKey.get('Circuit.Sim.tickLoop')?.stages[1];
    expect(tickTap?.kind).toBe('tap(symbol)');
    expect(tickTap?.flows).toBe('void');

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
    // fork(symbol)-card floor drop (69 → 60) and the stroke-sharing dedup
    // (60 → 57) both predate this card — see git history for their own
    // reasoning. THIS card's floor drop (57 → 45, a DELIBERATE shrink, not a
    // regression): the generation sequence used to be duplicated into BOTH
    // tickLoop's and stepOnce's own stage trees by the construction-time DRY
    // function appendGeneration (9 stages, counted twice = 18 total
    // contribution). Now it is ONE pipe (`advanceGenerationPipe`,
    // advanceGeneration.ts, still 9 stages) bound to its own port symbol and
    // referenced by tickLoop/step as a `tap(symbol)`/`pipe(symbol)` stage —
    // counted ONCE (9), not twice. tickLoop itself shrinks from 12 stages to
    // 4 (its own entry switch + the tap(symbol) reference + sleep + the
    // self-divert bridge); stepOnce (10 stages: the appendGeneration copy
    // plus its own minimal entry pass-through) is replaced by step's single
    // `pipe(symbol)` stage (1). Net: a real dedup on the graph (the sequence
    // has exactly one owning endpoint now), not a coverage loss.
    expect(sites.length).toBeGreaterThanOrEqual(45); // total stage count of the current catalog (shrinking further = regression signal)
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
    // orphanEntry stays ZERO (dropped 1 → 0 earlier): stepOnce,
    // the last real orphan, was resolved the SAME structural
    // way tickLoop's orphan was — a distinct catalogued saga node
    // reached by an external `divertsTo` edge from a calling stage — but with
    // a DIFFERENT verb: `step` reached `stepOnce` via `divert` (in-pipe,
    // on-bus, awaited by `kernel.run`), not play's detached `.spawn`, because
    // step's one-shot lap has no daemon guard of its own and must stay
    // serialized by the bus. `stepOnce` (and that divert) no longer exist at
    // all: the whole hop is superseded by a symbol-composition edge
    // into `Circuit.Sim.advanceGeneration` (`pipeline(symbol)`, step.ts) —
    // orphanEntry stays at zero for the new, structurally different reason
    // that `advanceGeneration` is directly BOUND (not merely divert-reached),
    // so orphan status was never even a question for it.
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

  it('parts: all 14 part files (switch 3 / emitter 2 / mutator 7 / bridge 2) are indexed with usedBy — the subgraph as nodes', () => {
    // The test above (the handler.site reference floor) is "prevention of dead
    // part files" seen from the filesystem side. This one is the index itself
    // producing the parts section — the subgraph-as-nodes answer to "can this
    // fact be obtained without leaving the index?" (paving the index). The
    // expectation is pinned by count and breakdown (a completeness net must not
    // bless regressions — an expectation-lowering diff is the strongest
    // regression signal).
    //
    // The 3 switches: runningPhase / cellVisit / loadedSettings — unaffected
    // by this change (unchanged since the fork(symbol) migration: see git
    // history for that migration's own reasoning). The 7 mutators: running
    // (pause only) / advanceGeneration (renamed from generation) / randomize /
    // toggleCell / stroke / simState / kernelError — also unaffected in count,
    // only advanceGeneration's name changed. The 2 emitters: advanceGeneration
    // (renamed from generation) / randomize.
    //
    // The bridges drop from 3 to 2 THIS card: `stepOnce.bridge.ts` is deleted
    // along with the pipe it hopped into (`stepOnce.ts`) — the one-shot hop it
    // used to name is superseded by referencing the generation sequence
    // directly as a port symbol (`Circuit.Sim.advanceGeneration`,
    // `pipeline(symbol)` in step.ts) — a symbol-composition edge, not a
    // divert, so there is no bridge hop left to name. `tickLoop.bridge.ts`
    // (the self-divert reentry, shared with play's `.spawn` launcher) and
    // `strokeMove.bridge.ts` (strokeStart's hop into strokeMovePipe, carrying
    // its cursor — owner-decided 2026-07-19) remain the 2 survivors.
    const parts = document.parts ?? [];
    const byKind = new Map<string, number>();
    for (const part of parts) byKind.set(part.kind, (byKind.get(part.kind) ?? 0) + 1);
    expect(Object.fromEntries(byKind)).toEqual({ mutator: 7, switch: 3, emitter: 2, bridge: 2 });
    expect(parts).toHaveLength(14);

    // usedBy is non-empty for every part (empty would raise a partUsage
    // unresolved — the index-side shape of the same CI-floor fact).
    for (const part of parts) {
      expect(part.usedBy.length, `${part.file}: dead part file (usedBy empty)`).toBeGreaterThan(0);
    }
    expect((document.unresolved ?? []).filter((u) => u.kind === 'partUsage')).toEqual([]);

    // A part's identity is (name, kind) — the owning pipeline goes into name
    // and the role into kind. advanceGeneration / randomize share a name
    // between emitter and mutator, so name alone cannot look them up.
    const byId = new Map(parts.map((p) => [`${p.name}.${p.kind}`, p]));
    expect(byId.size).toBe(parts.length); // the (name, kind) uniqueness itself is a floor
    // Representative values: shared parts name all their users (usedBy is
    // sorted). advanceGeneration.emitter/.mutator now name exactly ONE user —
    // `Circuit.Sim.advanceGeneration` itself — because advanceGenerationPipe
    // OWNS both directly (it is no longer a shared stage sequence appended by
    // two callers; tickLoop and step reference it as a port symbol instead).
    // This is the direct, intended consequence of this card: part attribution
    // is now one-to-one with the single owning endpoint, not fanned out across
    // every caller that used to inline a copy of the sequence.
    expect(byId.get('advanceGeneration.emitter')?.usedBy).toEqual(['Circuit.Sim.advanceGeneration']);
    expect(byId.get('advanceGeneration.mutator')?.usedBy).toEqual(['Circuit.Sim.advanceGeneration']);
    // cellVisit.switch: strokeMove-only now — it lives solely in
    // strokeMovePipe (stroke.ts). strokeStart no longer reaches it directly;
    // it hops into strokeMovePipe first (strokeMove.bridge.ts), so
    // strokeStart's usedBy edge is on strokeMove.bridge, not here.
    expect(byId.get('cellVisit.switch')?.usedBy).toEqual(['Circuit.Sim.strokeMove']);
    // A mutator's usedBy is the UNION of StageEntry.handler.site (chain-link /
    // entry bare identifiers) and command endpoints' declaration sites
    // (assembly.ts) — either path counts regardless of kind. running now holds
    // only `pause` (a command endpoint's declaration site); `play` graduated to
    // a saga when its launch became a `.spawn`, so it no longer references this
    // Mutator.
    expect(byId.get('running.mutator')?.usedBy).toEqual(['Circuit.Sim.pause']);
    // kernelError.mutator: the same shape as running.mutator — a command
    // endpoint's declaration site is its sole usedBy entry (Circuit.Faults.clearError
    // calls no symbol, so it stays a plain Mutator with no chain-link handler.site).
    expect(byId.get('kernelError.mutator')?.usedBy).toEqual(['Circuit.Faults.clearError']);
    // The randomize/toggleCell mutators go via handler.site (bare identifiers
    // of chain-link `.effect(...)`), unaffected by this card.
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
    // tickLoop.bridge is shared: the loop's self-divert reentry (tickLoop)
    // AND play's `.spawn` launcher both reuse it (the same fixed "divert into
    // tickLoop" hop).
    expect(byId.get('tickLoop.bridge')?.usedBy).toEqual(['Circuit.Sim.play', 'Circuit.Sim.tickLoop']);
    expect(byId.has('stepOnce.bridge')).toBe(false); // deleted this card, along with stepOnce.ts
    // strokeMove.bridge: strokeStart's fixed hop into strokeMovePipe — also a
    // ONE-SHOT connector (not a self-divert). strokeMovePipe itself does NOT
    // use the bridge (it is the divert TARGET, reached by dispatch too), so
    // the sole user is strokeStart.
    expect(byId.get('strokeMove.bridge')?.usedBy).toEqual(['Circuit.Sim.strokeStart']);
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
    // granularity.switch / stepGranularity.switch are ALSO gone (deleted by
    // the earlier fork(symbol) card, files removed entirely — reclassified as
    // tickLoop.bridge / the now-also-deleted stepOnce.bridge, not moved to a
    // gate).
    expect(byId.has('granularity.switch')).toBe(false);
    expect(byId.has('stepGranularity.switch')).toBe(false);
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

  it('sharedStages: only builder helpers shared by 2+ endpoints are indexed — now honestly empty (appendGeneration retired)', () => {
    // The chain splice already knows "which endpoint went through which helper"
    // — this pins that the record is not discarded and reaches sharedStages.
    // Named stage HANDLERS (sleepForSpeed / tickLoopBridge etc.) are not
    // sharedStages (that is the StageEntry.handler axis). Any fork-branch-side
    // value→branch builder would not be indexed here either (valueSelectors /
    // branchSelector are already their address) — moot today since this app's
    // own `valueSelectors` is `[]` (see the dedicated test above). Helpers used
    // by only 1 endpoint are by definition not indexed (SharedStageEntry doc:
    // "shared by 2+ endpoints") — their absence is spec, not a miss.
    //
    // appendGeneration — the last remaining sharedStages entry — is ALSO gone
    // this card, for the same underlying reason appendStrokeVisit went first
    // (owner-decided 2026-07-19): sharing is pipeline-value composition, never
    // a construction-time helper function. The generation sequence is now ONE
    // pipe bound to its own port symbol (`Circuit.Sim.advanceGeneration`,
    // advanceGeneration.ts), and tickLoop/step reference it as a
    // `tap(symbol)`/`pipe(symbol)` stage — there is no second stage-tree copy
    // for a chain splice to attribute, so there is nothing left for
    // sharedStages to name. That shared node's "2 real callers" fact now
    // lives on `document.symbols[].usedByStagesOf` instead (see the
    // shared-symbol test above and the dedicated advanceGeneration
    // reach-path test), not in sharedStages. With both former entries gone,
    // `sharedStages` is now honestly `[]` for this app's entire topology —
    // not an unscanned null (see the parts/sharedStages-are-real-arrays test
    // below), a genuine zero.
    expect(document.sharedStages).toEqual([]);
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
