# kernelee-lifegame

A showcase app for the [kernelee](https://github.com/s-age/kernelee) framework: Conway's Game of Life.
It puts kernelee's two primitives front and center, with a deliberate division
of labor between them —

- **divert = self-repetition, O(1) stack** — the final stage of `tickLoopPipe`
  diverts back to itself (a fixed, decisionless hop — see "fork is cooperative
  concurrency" below). A divert is iteration, not recursion (it swaps in a
  stage list and a value and continues from index=0), so running tens of
  thousands of generations stays O(1) on the stack.
- **fork = the runtime-*variable* axis** — `.fork(Compute.Life.stepIndexRange)`
  fans a Compute-computed, runtime-sized range list out to that one symbol,
  once per element, collected in order and joined into a single board by
  `.map` (an Emitter that only aggregates). The range list itself comes from
  `Compute.Life.partitionRanges`, read fresh every lap from
  `SimState.granularity`: **chunk** (4 row chunks) / **row** (one range per
  row) / **cell** (one range per cell — the degenerate form of "cell =
  pipeline"). The Fork selector in the UI can switch granularity while the
  simulation is running, so you can feel the trade-off between granularity and
  overhead — the switch takes effect from the next generation, because the
  range list is recomputed every lap regardless of where the (now fixed)
  self-divert leads.

The board engine lives in the Contract/Compute/Circuit rings and can be driven
from tests without any UI. On top of it, `src/presentation/` implements a
react-kernelee based board UI (a canvas board plus a control bar) — see the
"UI" section below.

## Setup

This app consumes its framework packages (`@s-age/kernelee`,
`@s-age/react-kernelee`, `@s-age/kernelee-devtools-bridge`,
`@s-age/kernelee-mcp-tools`) from npm:

```sh
npm install
npm test           # vitest run (Compute / Wiring / Circuit / presentation UI)
npm run typecheck  # tsc --noEmit
npm run dev        # vite (board UI)
npm run build      # vite build
npm run preview    # vite preview (serves the built dist/)
```

## Ring layout

```
src/
├── contract/   # ports (defineCallable) + states (defineState) — depends on nothing but kernelee
│   ├── states.ts   GridState / SimState / StatsState (transition stats)
│   └── ports.ts    'Compute.Life' (port) / 'Circuit.Sim' (portK)
├── compute/    # pure logic — depends only on contract (kernel-free)
│   ├── life.ts     stepIndexRange (B3/S23 over row-major flat index ranges) / hitCell / diffStats / randomize
│   └── device.ts   lifeDevice (conforms to LifeDevice)
├── circuit/    # sagas — contract + kernelee only (compute is called via symbols)
│   └── sim/        circuit taxonomy (saga / Switch / Emitter / Bridge), 1 unit = 1 file
│       ├── tickLoop.ts            saga: self-diverting generation loop (module constant)
│       ├── tickLoop.bridge.ts     Bridge: fixed self-divert hop (reused by play's .spawn launcher)
│       ├── step.ts                saga: one gated iteration — its one stage IS the
│       │                          Circuit.Sim.advanceGeneration symbol (pipeline(symbol))
│       ├── toggleCell.ts          saga: cell-flip transition (paired Stats emit)
│       ├── advanceGeneration.emitter.ts  Emitter: joins fork(symbol) results into a single board
│       ├── advanceGeneration.ts   the generation sequence, bound to its own port symbol
│       │                          (Circuit.Sim.advanceGeneration) — referenced, not appended, by
│       │                          tickLoop (.tap) and step (pipeline(symbol)) —
│       │                          partitionRanges (symbol) → fork(stepIndexRange, symbol)
│       ├── stroke.ts              stroke interpretation
│       └── device.ts              simDevice catalog (maps port symbols to implementations)
├── infrastructure/ # I/O devices — depend only on contract (no kernelee; leaf handlers)
│   └── settingsStore.ts  persists the settings JSON to localStorage (makeSettingsStore / memoryStorage)
├── driver/     # wiring manifest — the only place that wires every device
│   └── wiring.ts   wireAllDevices / makeKernel (infrastructure devices are injected as required arguments)
├── presentation/ # React views — depend only on contract + react-kernelee
│   ├── App.tsx         overall layout
│   ├── ControlBar.tsx  Play/Pause/Step/Randomize + speed slider
│   ├── GridCanvas.tsx  <canvas> board (subscription-driven drawing + a sensor that sends strokes in normalized coordinates)
│   ├── StatusBar.tsx   generation / transition stats (merely subscribes to StatsState)
│   ├── ErrorBanner.tsx renders useKernelError()
│   └── style.css       plain CSS (dark theme)
└── app/        # composition root — the only place that knows driver (makeKernel) and KernelProvider
    └── main.tsx
```

Dependency rules: contract → kernelee only / compute → contract only /
circuit → contract + kernelee (never imports compute / infrastructure
implementations — it goes through symbols) / infrastructure → contract only
(no kernelee — leaves do not take a kernel) / driver is the only place that
wires all devices / presentation → contract + react-kernelee only (no other
project ring is imported besides react itself).

Settings (Speed and Fork) are persisted to localStorage as JSON. On startup
`Circuit.Sim.hydrateSettings` restores them; mutations go disk-first, then
reflect into the buffer (so the buffer never claims a value the disk does not
have after a failed write). The board itself (a game in progress) is not
saved.

## Tick loop design (src/circuit/sim/)

`tickLoopPipe` is a single module constant (no more per-(granularity, board
size) pipe variants) — granularity and board size are read fresh from the
buffer every lap, inside the pipe's own stages:

```
tickLoopPipe:
  runningPhase switch (abort unless running = natural stop, settles LoopState to idle)
  → take a board snapshot (buffer read)
  → assemble PartitionInput (granularity via buffer read)
  → pipe (Compute.Life.partitionRanges — board+granularity → ≥1 complete range payloads)
  → fork(symbol) (Compute.Life.stepIndexRange, fanned once per payload — N is a runtime value)
  → map (Emitter: order-preserving join, aggregation only — computing stats is a judgment, so it goes to the next stage)
  → pipe (Compute.Life.diffStats — the previous generation still lives in the buffer, pre-write)
  → effect (write to GridState + generation++, emit StatsState as a pair)
  → effect (sleep: 1000 / genPerSec ms, in 50ms slices so pause reacts promptly)
  → bridge (a fixed, decisionless hop back into this same tickLoopPipe — the self-divert reentry)
```

- **Launch rules**: `Circuit.Sim.play` arms `LoopState.phase` (via the
  `guard:loop.launchArm` gate — idle → launch fresh / else recover-only, no
  double start) and `.spawn`s the loop as a detached, untracked fork branch.
  **Never put the loop on dispatch (the serial CommandBus)** — the bus would
  be blocked forever.
- **pause**: moves `LoopState.phase` to `'stopping'`. The next lap's
  `runningPhase.switch.ts` reads that, locks the phase to `'idle'`, and
  aborts — the loop stops naturally.
- **step**: runs the same one-generation sequence as the loop body,
  exactly once, no sleep, no self-divert. Unlike the loop, `stepPipe`'s ONE
  stage simply IS the shared sequence's own port symbol
  (`Circuit.Sim.advanceGeneration`, entered via `pipeline(symbol)`) — there
  is no separate "step" pipe to hop into any more. tickLoop reaches the same
  symbol mid-pipe instead, via `.tap(SimPort.advanceGeneration)` (stages
  follow it: sleep, then the self-divert). Both forms compose through
  `kernel.invoke` directly (not the dispatch bus), so no deadlock risk either
  way — see `advanceGeneration.ts`'s own doc comment for the two-form
  rationale.
- **Granularity is a fork(symbol) input, not a pipe-selection axis**: before
  this shape, pipes were memoized keyed by (granularity, width, height) so the
  self-divert kept returning the identical instance. `fork(symbol)` replaced
  that whole pattern — `tickLoopPipe` and `advanceGenerationPipe` are each
  just one plain constant, and identity preservation for the self-divert is
  free (a constant is always itself). Granularity now only decides HOW MANY
  elements `Compute.Life.partitionRanges` hands to the fork, read fresh every
  lap.
- **The self-divert is a fixed hop**: `tickLoop.bridge.ts` is a decisionless
  Bridge — it reads no state and just diverts back into `tickLoopPipe` via a
  typed `DispatchKey` (`SimFlowKeys.tickLoop`), bound once at kernel-build
  time (`builder.flow(...)`, driver/wiring.ts). The same bridge is reused by
  `play`'s `.spawn` launcher for the loop's very first lap.

## fork: two vocabularies (static vs dynamic)

`fork` has two shapes in kernelee, and this app now uses both, for different
reasons:

- **Static `fork(branches)`** — a FIXED, small set of distinct sub-pipes
  decided at construction time (this app's example: the two-line
  board-line/stats-line fork in `advanceGeneration.ts`, right after the
  transition pair is assembled).
- **Dynamic `fork(symbol)`** — the SAME one symbol fanned out over a
  runtime-sized list (`.fork(Compute.Life.stepIndexRange)`, fed by
  `Compute.Life.partitionRanges`). This is what the generation loop's
  granularity axis uses: the range list's length varies by
  `SimState.granularity` and board size, decided fresh every lap, not at pipe
  construction time.

Both share the same join semantics (order-preserving, `Promise.all`,
fail-fast) — JS is single-threaded, so this is cooperative concurrency, **not
true CPU parallelism**. The point here is to demo fork's API shape (fan-out +
order-preserving join, branch verb semantics); for actual performance you
would need Workers (future scope). kernelee's fork has the same fail-fast
**outcome** as the Swift original, but sibling branches are not cancelled and
run to completion in the background (see the kernelee README).

## UI (src/presentation/)

A single plain-CSS screen that touches the board only through react-kernelee
(`KernelProvider` / `useBuffer` / `useDispatch` / `useKernelError`). In lieu
of a screenshot, an ASCII layout sketch:

```
┌──────────────────────────────────────────────────────────┐
│                    kernelee-lifegame                      │  ← App.tsx / .app-title
├──────────────────────────────────────────────────────────┤
│ [ ⚠ error message (KernelErrorState) ]                     │  ← ErrorBanner (hidden when null)
├──────────────────────────────────────────────────────────┤
│ ▶ Play ⏸ Pause ⏭ Step 🎲 Randomize  Speed: 10 gen/s ──○─  Fork: [chunk▾] │  ← ControlBar
├──────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐   │
│ │ · · · ■ · · ■ ■ · · · · · · · · · · · · · · · · · · │   │
│ │ · · ■ · · · ■ · ■ · · · · · · · · · · · · · · · · · │   │  ← GridCanvas
│ │ · · · ■ ■ · · · · · · · · · · · · · · · · · · · · · │   │    (a single <canvas>,
│ │ · · · · · · · · · · · · · · · · · · · · · · · · · · │   │     click/drag to toggleCell)
│ │             (64 × 48 cells, 12px/cell)               │   │
│ └────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│ Generation: 42   Alive: 213   Births: +18   Deaths: -25   │  ← StatusBar (subscribes to StatsState)
└──────────────────────────────────────────────────────────┘
```

- **read/dispatch only**: each component uses only `useBuffer` (read) and
  `useDispatch` (fire). Presentation never calls `kernel.call` /
  `kernel.compose` / `buffer.mutate` directly. Only the composition root
  (`src/app/main.tsx`) knows `makeKernel()` and `KernelProvider`, and right
  after startup it dispatches `kernel.dispatch(SimPort.randomize, undefined)`
  once to randomize the initial board.
- **Presentation is a transducer**: the view's job is exactly two directions
  of conversion — "subscribe → render" and "DOM sensor → normalize →
  dispatch" — with no interpretation, judgment, domain computation, or state
  of its own. alive/births/deaths are not scanned in the view; it subscribes
  to `StatsState` (transition stats the pipeline emits paired with
  GridState). Pointers are reduced to normalized coordinates (u, v) via rect
  measurement and sent as `strokeStart/Move/End` — interpreting them into
  cell coordinates is `Compute.Life.hitCell`'s job, and drag detection and
  same-cell dedup live in the circuit's stroke state.
- **Invariants are owned by the circuit**: double launch is guarded by the
  `guard:loop.launchArm` gate on `LoopState`, and stepping while running is
  blocked by the `guard:loop.idle` gate (abort) guarding `Circuit.Sim.step`
  itself — before step's one stage (the `advanceGeneration` symbol) is even
  reached. `ControlBar`'s disabled handling is decoration (rendering of
  state), not a load-bearing guard — if it falls off, nothing breaks.
- **Fork selector**: a `<select>` that merely dispatches
  `SimPort.setGranularity`. It stays enabled while running — the tick loop
  picks its divert target every iteration, so the switch takes effect from the
  next generation (switching to 'cell' granularity visibly drops gen/s — a
  live demonstration of granularity overhead).
- **GridCanvas**: cells are not DOM elements; the whole board is redrawn onto
  a single `<canvas>` (each new snapshot from `useBuffer(GridState)` is
  applied to the ctx in a `useEffect` — mutate-driven is enough, no rAF). The
  backing store is scaled by devicePixelRatio while the CSS size stays in
  logical pixels, avoiding blur. It holds no pointer interpretation — it just
  reduces down/move/up to normalized coordinates and dispatches
  `strokeStart/Move/End`; discarding moves outside a stroke and same-cell
  dedup are done by the circuit (the serial bus gives ordering guarantees for
  free).

### Monorepo dual-React caveat (vite.config.ts / vitest.config.ts)

`@s-age/react-kernelee` only lists `react` as a peer dependency, but npm's
resolver can still nest a second copy under its own `node_modules/react` if
hoisting doesn't line versions up. Without dedupe, the moment a
`react-kernelee` hook runs it grabs that other React instance and you get
`Invalid hook call` (the classic monorepo accident of two Reacts loaded at
once). Both `vite.config.ts` and `vitest.config.ts` force a single instance
with `resolve: { dedupe: ['react', 'react-dom'] }` (`vitest.config.ts` uses
`test.projects`, so it is needed both at the root and inside each project).

### UI tests (jsdom) coexisting with the engine tests (node)

`vitest.config.ts` splits into two projects via `test.projects`:
`tests/**/*.test.ts` (Compute/Circuit/Wiring, default `node` environment) and
`tests/presentation/**` (`jsdom` environment plus `setupFiles` enabling
`@testing-library/react`'s `cleanup()`). jsdom does not implement
`getContext('2d')` on `<canvas>` (it only prints a `Not implemented` stderr
warning, which is normal), so `GridCanvas` returns early and does nothing when
`ctx` is `null` — in a real browser it draws, of course.

## ★ Vite HMR caveat (never make contract an HMR boundary)

`defineState` / `defineCallable` keep a **module-global uniqueness ledger**.
If HMR re-executes a contract module, the same id gets minted twice and it
throws `duplicateStateId` / `duplicateSymbolId`.

As a countermeasure, the `contractFullReload` plugin in `vite.config.ts`
downgrades any edit under `src/contract/` to a **full reload** (page reload =
the ledger resets with it). If you edit contract in a setup without the
plugin, reload the page manually.

## kernelee-devtools-bridge connection (development only)

`src/app/main.tsx` connects to
[`kernelee-devtools-bridge`](https://github.com/s-age/kernelee-devtools-bridge) in development only
(`import.meta.env.DEV`), letting you view the actual pipe/fork wiring in a
browser panel (`http://localhost:7331/`, the default port). None of this
happens in production builds (`vite build`) or `vitest run` (`main.tsx` is not
imported by any test).

```sh
# start the bridge server first, in another terminal
npm run devtools   # launches the kernelee-devtools-bridge bin via this repo's scripts — listens on http://localhost:7331
npm run dev        # this repo
```

`npm run devtools` points at `"devtools": "kernelee-devtools-bridge"` in
`package.json` — any npm package that depends on `@s-age/kernelee-devtools-bridge`
gets the `bin` entry automatically symlinked into `node_modules/.bin/`, so
this just calls that; no new code is needed on the
`kernelee-devtools-bridge` side. Any app that depends on
`kernelee-devtools-bridge` gets the same experience by copying this one
`scripts` entry.

- **Import `'@s-age/kernelee-devtools-bridge/connector'` (the subpath), not
  `'@s-age/kernelee-devtools-bridge'` (the barrel)** — the barrel (`index.ts`) also
  re-exports the Node-only `server.ts` (which depends on
  `node:http`/`node:fs`/`node:path`/`ws`), and going through it makes
  `vite build` (Rollup) fail because the Node builtins cannot be resolved from
  the browser-facing empty stubs. `connector.ts` itself has zero Node
  dependencies (only the global `WebSocket`), so load it through this
  dedicated subpath. **Do not switch this import back to the barrel.**
- Running `npm run dev` without the bridge server up prints a single
  `console.debug` on the first failed connection; the subsequent retries
  (250ms → 8s cap, unbounded) are silent — this makes an un-started server
  ignorable in the normal dev flow (`connectDevtoolsBridge`'s default
  `onError` logs a `console.error` every time, so `main.tsx` overrides it).
- The catalog sent to the panel (assembled by `buildWiringCatalog()` in
  `src/circuit/wiringCatalog.ts` via `describePipe`/`projectWiringGraph` — all
  11 top-level pipes: `tickLoop` plus
  `play`/`step`/`advanceGeneration`/`randomize`/`toggleCell`/`strokeStart`/`strokeMove`/
  `setSpeed`/`setGranularity`/`hydrateSettings`) is sent exactly once right
  after startup. `tickLoop` and `advanceGeneration` are each a single
  module-constant `Pipe` (owner-decided 2026-07-18): granularity
  is read fresh from the buffer INSIDE `advanceGenerationPipe` on every lap
  (`Compute.Life.partitionRanges`), not baked into the pipe's own static
  shape at construction, so the former "fork branch count shown initially
  disagrees with the persisted granularity" limitation no longer applies —
  the catalog's static descriptor shows one `fork(symbol)` stage regardless
  of granularity; the panel simply has no branch count to disagree about.
  `tickLoop` is keyed by the typed `SimFlowKeys.tickLoop` dispatch key, which
  never appears in `boundSymbolIds` (it is a divert-only target, not a bound
  `portK` member), so it is shown as `kind: 'divertTarget'`. `advanceGeneration`
  IS a bound `portK` member (`Circuit.Sim.advanceGeneration`) with its own
  `describePipe` entry — a `kind: 'endpoint'`, like the other entries keyed
  by the `KernelSymbol.id` of the actually bound `SimPort`/`SettingsPort` —
  reached by tickLoop/step as a symbol-composition stage
  (`.tap`/`pipeline(symbol)`), never a divert.

### CI validation of the wiring catalog (`validateWiringGraph`)

`tests/wiringCatalog.test.ts` runs kernelee's `validateWiringGraph` against
the catalog assembled by `buildWiringCatalog()` (shared with main.tsx) and
pins `unresolvedDivertTarget` (a `divertsTo` pointing at a non-existent key)
at zero.

`orphanEntry` (a divertTarget nobody references) is also zero. `tickLoop`
used to be a permanent orphan — a pipe launched directly via `kernel.run`,
never bound through `register`/`registerVerb` — but has since gained a real
external `divertsTo` referrer: `play`'s detached `.spawn` launch diverts into
it (see `src/circuit/wiringCatalog.ts`'s own header comment, and
`scripts/wiringIssueAllowlist.ts`). A genuine graph edge, not suppression, so
`validateWiringGraph`'s orphan-key detection has nothing left to flag.
`stepOnce` — which used to be resolved the same way, via `step`'s in-pipe
`divert` — no longer exists at all: the one-lap generation body it named is
now `Circuit.Sim.advanceGeneration`, a directly BOUND `portK` member with its
own `describePipe` entry, so orphan status was never even a question for it
(an endpoint whose own bound symbol id is its catalog key needs no external
referrer to avoid being an orphan — the same shape as `play`/`randomize`/
`toggleCell`).

The RAW layer's CI expectation is instead a fixed, non-empty allowlist: the 3
`unlistedBoundSymbol` entries in `RAW_WIRING_ISSUE_ALLOWLIST`
(`Circuit.Sim.pause` / `Circuit.Sim.strokeEnd` / `Circuit.Faults.clearError`)
— bound `portK` members with no `describePipe` twin of their own, promoted to
command endpoints by `kernelee-mcp-tools`' scan. That is why the RAW CI
expectation is that fixed allowlist rather than `toEqual([])`: a future pipe
forgotten from the catalog, a typo'd `divertsTo`, or a promotion regression
surfaces immediately as a new issue outside the fixed list. The ASSEMBLED
layer (post `runIntrospect`, used by `scripts/introspect.config.ts` /
`tests/introspectIndex.test.ts`) subtracts those same 3 promoted entries from
RAW and is therefore empty.

## License

[MIT](LICENSE) © s-age
