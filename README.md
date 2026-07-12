# kernelee-lifegame

A showcase app for the [kernelee](https://github.com/s-age/kernelee) framework: Conway's Game of Life.
It puts kernelee's two primitives front and center —

- **divert = the generation loop** — the final stage of `tickLoopPipe` diverts
  to itself with `divert(diversion(tickLoopPipe, undefined))`. A divert is
  iteration, not recursion (it swaps in a stage list and a value and continues
  from index=0), so running tens of thousands of generations stays O(1) on the
  stack.
- **fork = parallel computation over row chunks** — a board snapshot fans out
  to N branches, which are collected in order and joined into a single board by
  `.map` (an Emitter that only aggregates). The split granularity has three
  levels (`SimState.granularity`): **chunk** (4 row chunks) / **row** (one
  branch per row) / **cell** (one branch per cell — the degenerate form of
  "cell = pipeline"). The Fork selector in the UI can switch granularity while
  the simulation is running, so you can feel the trade-off between granularity
  and overhead. The switch takes effect from the next generation, as a
  **runtime selection of the divert target** in the tick loop's final stage.

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
│   └── sim/        circuit taxonomy (saga / Switch / Emitter), 1 unit = 1 file
│       ├── tickLoop.ts            saga: per-granularity divert loop + launch rules
│       ├── stepOnce.ts            saga: one gated iteration
│       ├── toggleCell.ts          saga: cell-flip transition (paired Stats emit)
│       ├── granularity.switch.ts  Switch: translates a decision (granularity) into a divert target
│       ├── generation.emitter.ts  Emitter: joins fork results into a single board
│       ├── generation.ts          the shared stage list for one generation (both sagas append it)
│       ├── branches/              fork branches (1 builder = rangeBranch × N ranges; granularity is just how the ranges are cut)
│       ├── stroke.ts              stroke interpretation / cache.ts pipe memoization
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

```
tickLoopPipeFor(granularity, width, height):
  running gate (if false, abort = natural stop; lowers loopActive)
  → take a board snapshot (buffer read)
  → fork [branch 1..N] (rangeBranch × N; the ranges depend on granularity: chunk=CHUNK_COUNT branches /
                          row=height branches / cell=width*height branches; declared via runtimeArity)
  → map (Emitter: order-preserving join, aggregation only — computing stats is a judgment, so it goes to the next stage)
  → pipe (Compute.Life.diffStats — the previous generation still lives in the buffer, pre-write)
  → effect (write to GridState + generation++, emit StatsState as a pair)
  → effect (sleep: 1000 / genPerSec ms, in 50ms slices so pause reacts promptly)
  → divert (read SimState.granularity and select the next iteration's loop pipe at runtime —
            if the granularity is unchanged, the cache returns the identical instance, making it a self-divert)
```

- **Launch rules**: `Circuit.Sim.play` sets `running=true` and, only if no loop
  is active, launches `kernel.run(tickLoopPipe)` fire-and-forget (errors go to
  `KernelErrorState`). **Never put the loop on dispatch (the serial
  CommandBus)** — the bus would be blocked forever. The double-launch guard is
  a separate piece of internal state from `SimState.running`: `activeLoops`, a
  WeakSet keyed by kernel.
- **pause**: just sets `running=false`. The next iteration's gate aborts, the
  loop stops naturally, and the gate lowers loopActive.
- **step**: runs the same one-generation stage list as the loop body
  (`appendGeneration`), exactly once, without gate / sleep / divert
  (`stepOncePipeFor`). PipeBuilder is immutable, so the shared stage list is
  kept DRY as a function that "appends the same tail to different preludes".
- **Granularity and the pipe cache**: pipes are memoized keyed by
  (granularity, width, height). Returning the same `Pipe` value for the same
  key is what keeps the divert "self"-referential, and the 'cell' granularity
  (width×height branches) defers construction until first requested. That the
  fork's branch count varies per construction is declared to introspection via
  `runtimeArity`.
- **Resolving the self-reference**: the final stage's closure calls
  `tickLoopPipeFor` at run time (after seal), so it never hits the TDZ — lazy
  reference through a closure solves the definition-order problem. Granularity
  switching is realized as this "runtime selection of the divert target"
  (`StageDescriptor.divertsTo` is the author's declaration of the candidates).

## fork is cooperative concurrency (an honest note)

JS is single-threaded, so the N fork branches are **not true CPU
parallelism**. It is cooperative concurrency via `Promise.all` — the point
here is to demo fork's API shape (fan-out + order-preserving join, branch verb
semantics); for actual performance you would need Workers (future scope).
Also, kernelee's fork has the same fail-fast **outcome** as the Swift
original, but sibling branches are not cancelled and run to completion in the
background (see the kernelee README).

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
- **Invariants are owned by the circuit**: double launch is guarded by
  `activeLoops`, and stepping while running is blocked by the gate (abort) at
  the entrance of `stepOncePipe`. `ControlBar`'s disabled handling is
  decoration (rendering of state), not a load-bearing guard — if it falls off,
  nothing breaks.
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
  9 top-level pipes: `tickLoop`/`stepOnce` plus
  `randomize`/`toggleCell`/`strokeStart`/`strokeMove`/`setSpeed`/
  `setGranularity`/`hydrateSettings`) is sent exactly once right after
  startup. `SimState.granularity` is assumed to be its default `'chunk'`
  during construction, so for a user whose persisted granularity (via
  `Circuit.Settings.setGranularity`) is anything other than `'chunk'`, the
  fork branch count shown initially disagrees with the actual setting
  (`dispatch` is fire-and-forget and cannot wait for hydrate to finish — a
  known limitation). Only the `tickLoop`/`stepOnce` entries are keyed by
  self-`divertsTo` strings that never appear in `boundSymbolIds`, so they are
  shown as `kind: 'divertTarget'` (the other 7 entries are keyed by the
  `KernelSymbol.id` of the actually bound `SimPort`/`SettingsPort`, hence
  `kind: 'endpoint'`).

### CI validation of the wiring catalog (`validateWiringGraph`)

`tests/wiringCatalog.test.ts` runs kernelee's `validateWiringGraph` against
the catalog assembled by `buildWiringCatalog()` (shared with main.tsx) and
pins two facts: `unresolvedDivertTarget` (a `divertsTo` pointing at a
non-existent key) is zero, and `orphanEntry` (a divertTarget nobody
references) is exactly the two known entries (`tickLoop`/`stepOnce`).

`tickLoop`/`stepOnce` remain orphans **permanently**, even with a complete
catalog — both are pipes launched directly via `kernel.run` without ever
being bound through `register`/`registerVerb`, and the only `divertsTo`
declarations in the whole app are `tickLoop`'s own self-loop and the one in
`stroke.ts` targeting `toggleCell`, so nothing ever points at these two. This
is not a false positive from catalog incompleteness but a structural property
of how these two pipes are launched, and `validateWiringGraph`'s orphan-key
detection cannot dissolve it. That is why the CI expectation is a fixed
two-entry allowlist rather than `toEqual([])` — if a future pipe is forgotten
from the catalog or a `divertsTo` is typo'd, it surfaces immediately as a new
issue outside the fixed list.

## License

[MIT](LICENSE) © s-age
