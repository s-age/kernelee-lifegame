// tests/traceDump.harness.ts — headless trace-dump harness (design card 69A1C1B8, task α).
//
// Lives under tests/ (not scripts/) and is deliberately NOT named `*.test.ts`:
// the kernelee-mcp-tools static scan excludes everything under a `tests/`
// segment (src/scan/project.ts's `isScannableSource`), so its direct
// `kernel.call(SimPort.toggleCell/step/randomize)` calls never fabricate
// production `drivenBy` edges in index.json — keeping the shipped app's
// "toggleCell is only ever reached via strokeStart/strokeMove divert, never
// dispatched directly" invariant intact (tests/introspectIndex.test.ts pins
// it). The non-`.test.ts` name also keeps vitest from collecting this file as
// a suite (vitest's include glob is `tests/**/*.test.ts`); it is a one-shot
// ops harness, run by hand via `npm run trace:dump` / `npx tsx`.
//
// Builds the lifegame kernel with tracing ON and the DEFAULT sink (no custom
// `onTrace`, unlike main.tsx's devtools-bridge path — see driver/wiring.ts's
// `makeKernel` doc comment for why the two are mutually exclusive), so the
// runtime `TraceState` buffer cell actually gets written. Runs one discrete
// action via `kernel.call(...)`, then dumps `TraceState`'s value
// (`{ entries: TraceEntry[] }`) to a JSON file. That file is exactly what the
// sibling tool `arch_monitor` (kernelee-mcp-tools) reads via its
// `KERNEL_INTROSPECT_TRACE_PATH` env var — this script is the "expected" half
// of the agent-closed verification loop card 69A1C1B8 sets up (arch_endpoint
// = expected, arch_monitor = actual).
//
// SCOPE — discrete, terminating actions only: `step` / `toggleCell` /
// `randomize`. `play` is deliberately OUT OF SCOPE: it launches the tick loop
// as a non-terminating, fire-and-forget `.spawn` branch (circuit/sim/play.ts)
// — there is no "it settled" moment for a one-shot dump to wait on, and
// Play-time high-rate observation is exactly the sampling regime the card's
// cap-300 `TraceState` ring is sized to exclude, not to capture.
//
// Each `kernel.call(...)` this script makes — including the seed `toggleCell`
// calls below — is its OWN root flow (its own root span, `parentId`
// undefined; see kernel.ts's `runStages` doc comment on span parentage). So a
// dump legitimately contains several distinct root spans: the seed calls plus
// the one action under study, or (with `--repeat`) N independent flows for
// exercising arch_monitor's `flow=`/`since` filters. That is NOT the same
// thing as one divert loop folding into a single flow — the fold-able-loop
// case only arises under `play`'s self-divert, which this script excludes by
// construction (it never calls `SimPort.play`).
//
// Argv contract: `tsx tests/traceDump.harness.ts [action] [outPath] [x] [y] [--repeat N]`
//   action  — 'step' (default) | 'toggleCell' | 'randomize'
//   outPath — default '.claude/introspect/trace.json' (same directory
//             convention as introspect.config.ts's index.json; gitignored)
//   x, y    — cell coordinate for 'toggleCell' (default 0, 0); ignored otherwise
//   --repeat N — run the action N times (N independent root flows) instead of
//             once; default 1. Seeding (below) still runs only once regardless.
//
// Seeding: for 'step', a handful of `toggleCell` calls place the same
// horizontal blinker circuit.test.ts's `placeBlinker` uses — (1,2)-(3,2) —
// before the timed action runs, so the dumped generation is non-trivial
// (a real birth/death transition) rather than an empty board stepping to
// itself. 'toggleCell' and 'randomize' need no seed: the call under study
// already produces a non-trivial transition on its own.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TraceState } from '@s-age/kernelee';
import { SimPort, type CellCoord } from '../src/contract/ports';
import { makeKernel } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT_PATH = resolve(repoRoot, '.claude/introspect/trace.json');

type Action = 'step' | 'toggleCell' | 'randomize';

function parseArgs(argv: readonly string[]): { action: Action; outPath: string; coord: CellCoord; repeat: number } {
  // `--repeat N` can appear anywhere; strip it out before reading positionals.
  const repeatIndex = argv.indexOf('--repeat');
  const repeat = repeatIndex === -1 ? 1 : Number(argv[repeatIndex + 1] ?? '1');
  const positionals = repeatIndex === -1 ? argv : [...argv.slice(0, repeatIndex), ...argv.slice(repeatIndex + 2)];

  const [rawAction, rawOutPath, rawX, rawY] = positionals;
  const action: Action = rawAction === 'toggleCell' || rawAction === 'randomize' ? rawAction : 'step';
  const outPath = rawOutPath ? resolve(repoRoot, rawOutPath) : DEFAULT_OUT_PATH;
  const coord: CellCoord = { x: Number(rawX ?? '0'), y: Number(rawY ?? '0') };
  return { action, outPath, coord, repeat: Number.isFinite(repeat) && repeat > 0 ? repeat : 1 };
}

async function main(): Promise<void> {
  const { action, outPath, coord, repeat } = parseArgs(process.argv.slice(2));

  // `trace: {}` (onTrace omitted) — tracing on, DEFAULT sink, so `TraceState`
  // is populated. This is the shape driver/wiring.ts's `makeKernel` added
  // specifically for this harness (main.tsx's devtools path passes `{
  // onTrace }` instead, which replaces the default sink and leaves
  // `TraceState` empty — see that function's own doc comment).
  const { kernel } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) }, {});

  if (action === 'step') {
    // Seed pattern mirrors tests/circuit.test.ts's placeBlinker: a horizontal
    // blinker at (1,2)-(3,2), so `step` turns it vertical (a real transition)
    // rather than stepping an empty board to itself.
    await kernel.call(SimPort.toggleCell, { x: 1, y: 2 });
    await kernel.call(SimPort.toggleCell, { x: 2, y: 2 });
    await kernel.call(SimPort.toggleCell, { x: 3, y: 2 });
  }

  for (let i = 0; i < repeat; i += 1) {
    if (action === 'step') await kernel.call(SimPort.step);
    else if (action === 'toggleCell') await kernel.call(SimPort.toggleCell, coord);
    else await kernel.call(SimPort.randomize);
  }

  const dump = kernel.buffer.read(TraceState);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dump, null, 2));

  const rootSpanIds = dump.entries.filter((entry) => entry.span.parentId === undefined).map((entry) => entry.span.id);
  console.log(`trace-dump: wrote ${outPath}`);
  console.log(`trace-dump: ${dump.entries.length} entries, ${rootSpanIds.length} root span(s):`);
  for (const id of rootSpanIds) console.log(`  ${id}`);
}

main().catch((error) => {
  console.error('trace-dump: failed —', error);
  process.exitCode = 1;
});
