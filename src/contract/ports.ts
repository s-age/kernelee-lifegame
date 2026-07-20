// contract/ports.ts — port declarations (defineCallable).
// Ring rule: contract depends on nothing but kernelee.
// The symbols, device types, and wiring are all derived from this spec (the totality triangle).
//
// ★ Vite HMR note: `defineCallable` also keeps a module-global registry
// (`duplicateSymbolId`) — as with states.ts, never make contract an HMR boundary.

import { actionsOf, defineCallable, dispatchKey, port, portK, type CallableDeviceOf } from '@s-age/kernelee';
import type { CellCoord, ForkGranularity, Stats } from './states';

/** `CellCoord` is defined in contract/states.ts (Stroke keeps it in a Buffer;
 * this is a plain re-export that preserves the ports→states import direction). */
export type { CellCoord };

// MARK: - Compute.Life payload types

/**
 * Input for `stepIndexRange`. `cells` is the whole board (read-only reference —
 * the implementation must not mutate it); only the row-major flat indices from
 * `start` (inclusive) to `end` (exclusive) are computed (index = y * width + x).
 * The split granularity (chunk/row/cell) is nothing more than a different way of
 * choosing this range, so the Compute symbol is unified into a single one.
 * The return value is a Uint8Array covering just that range (length = end - start).
 */
export interface StepIndexRangeInput {
  readonly cells: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly start: number;
  readonly end: number;
}

/**
 * Input for `partitionRanges`. `cells`/`width`/`height` are a board snapshot
 * (already read from the buffer by the caller); `granularity` picks how many
 * ranges to carve it into (chunk=CHUNK_COUNT / row=height / cell=width*height).
 */
export interface PartitionInput {
  readonly cells: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly granularity: ForkGranularity;
}

/** Input for `randomize`. When `seed` is omitted the implementation picks a non-deterministic seed. */
export interface RandomizeInput {
  readonly width: number;
  readonly height: number;
  /** Target density of live cells (0..1). */
  readonly density: number;
  readonly seed?: number;
}

/**
 * Normalized pointer coordinates (relative to the canvas logical size; [0,1) is
 * inside the board). Presentation only reduces pointer events to this via rect
 * measurement (a sensor) — interpreting them as cell coordinates is Compute's
 * job (`hitCell`).
 */
export interface NormalizedPoint {
  readonly u: number;
  readonly v: number;
}

/** Input for `hitCell`. Resolves a cell coordinate from normalized coordinates and the board size. */
export interface HitCellInput {
  readonly u: number;
  readonly v: number;
  readonly width: number;
  readonly height: number;
}

/** Input for `diffStats`. Aggregates the board transition `prev` → `next`. */
export interface DiffStatsInput {
  readonly prev: Uint8Array;
  readonly next: Uint8Array;
}

// MARK: - Infrastructure.Settings payload types

/**
 * Persisted settings (whole-value replacement). Only the two UI knobs Speed / Fork —
 * `running` is runtime state and the board is not a domain worth saving, so
 * neither is included.
 */
export interface SimSettings {
  readonly genPerSec: number;
  readonly granularity: ForkGranularity;
}

// MARK: - Ports

/**
 * Pure computation port (leaf, value-returning). Implemented by the Compute ring (kernel-independent).
 */
export const LifePort = defineCallable('Compute.Life', {
  stepIndexRange: port<StepIndexRangeInput, Uint8Array>(
    'Advance the cells in start..end (half-open range, flat indices) one generation under B3/S23 with torus boundaries, returning just that range',
  ),
  partitionRanges: port<PartitionInput, ReadonlyArray<StepIndexRangeInput>>(
    'Partition a w×h board (w,h ≥ 1) by granularity (chunk=CHUNK_COUNT/row=height/cell=width*height) into ≥1 complete StepIndexRangeInput payloads whose ranges are non-overlapping, row-major-ordered, and jointly cover the whole board — cells is the same reference shared by every element',
  ),
  randomize: port<RandomizeInput, Uint8Array>(
    'Generate a random board of the given density with a seeded PRNG (mulberry32) — same seed, same board',
  ),
  hitCell: port<HitCellInput, CellCoord | null>(
    'Resolve normalized pointer coordinates (u, v) to a cell coordinate (null when outside the board) — the output is in cell space, so this is Compute work',
  ),
  diffStats: port<DiffStatsInput, Stats>(
    'Aggregate alive / births / deaths for the board transition prev → next (births/deaths can only be computed from the transition pair)',
  ),
});

/**
 * Settings persistence port (leaf, value-returning). Implemented by the
 * Infrastructure ring. Read/write discipline: load is defensive (missing or
 * corrupt data yields null — settings never block startup), save is whole-value
 * replacement. "Rules" such as clamping are owned by Circuit.
 */
export const SettingsStorePort = defineCallable('Infrastructure.Settings', {
  load: port<void, SimSettings | null>(
    'Read the saved settings JSON — missing file, parse failure, and shape mismatch all yield null (defensive: settings never block startup)',
  ),
  save: port<SimSettings, void>(
    'Replace the saved settings JSON whole-value',
  ),
});

/**
 * Simulation operations port (composite, kernel-first). Implemented by the
 * Circuit ring — reads/writes buffers and drives the tick loop (divert) and
 * chunked computation (fork).
 */
export const SimPort = defineCallable('Circuit.Sim', {
  play: portK<void, void>(
    'Set LoopState.phase to running and, only when it was idle, launch the tick loop (self-divert) fire-and-forget (from stopping the existing loop is reused, so no double start)',
  ),
  pause: portK<void, void>(
    'Set phase to stopping only while running — the next lap gate aborts, drops to idle, and the loop stops naturally',
  ),
  step: portK<void, void>(
    'Advance exactly one generation without changing LoopState.phase (run the same stage sequence as the loop body for a single lap; abort unless idle)',
  ),
  randomize: portK<void, void>(
    'Generate a random board via Compute.Life.randomize, write it, and reset generation to 0',
  ),
  toggleCell: portK<CellCoord, void>(
    'Flip the given cell dead/alive (replace cells copy-on-write and emit StatsState alongside)',
  ),
  strokeStart: portK<NormalizedPoint, void>(
    'Begin a stroke — resolve to a cell via hitCell, toggle it, and set up the stroke state (last-touched cell)',
  ),
  strokeMove: portK<NormalizedPoint, void>(
    'Continue a stroke — ignored unless a stroke is active. Consecutive moves within the same cell are deduped before toggling',
  ),
  strokeEnd: portK<void, void>(
    'End a stroke — discard the stroke state',
  ),
  advanceGeneration: portK<void, void>(
    'Advance the board exactly one generation (pair-emitting GridState + StatsState). A predefined process invoked mid-pipe by tickLoop and step — not a command intended for dispatch.',
  ),
});

/**
 * Settings operations port (composite, kernel-first). Implemented by the
 * Circuit ring's settings family; the family maps 1:1 to the port namespace
 * (circuit/settings/). The "rules" — clamping, ignoring unknown values — are
 * owned by this family; the store (Infrastructure.Settings) only guards shape (types).
 */
export const SettingsPort = defineCallable('Circuit.Settings', {
  setSpeed: portK<number, void>(
    'Set genPerSec (generations per second), clamped to a positive finite value — disk first, then reflect into the buffer',
  ),
  setGranularity: portK<ForkGranularity, void>(
    'Set the fork granularity (chunk/row/cell); unknown values are ignored — the tick loop picks its divert target every lap, so this takes effect from the next generation',
  ),
  hydrateSettings: portK<void, void>(
    'Reflect saved settings (Infrastructure.Settings.load) into SimState — missing or invalid data keeps the defaults. Dispatched once by app at startup',
  ),
});

/**
 * Error-surface operations port (composite, kernel-first). Implemented by the
 * Circuit ring's faults family (circuit/faults/, mapping 1:1 to the port
 * namespace). Isolated from sim/settings because clearing the error banner is
 * not domain to either — it acts on the framework-owned `KernelErrorState`
 * cell, not on this app's own board/settings state.
 */
export const FaultsPort = defineCallable('Circuit.Faults', {
  clearError: portK<void, void>(
    'Clear KernelErrorState back to { message: null } — the displaying view (ErrorBanner) dispatches this to dismiss the banner; the default error sink only ever writes the cell, never clears it',
  ),
});

/**
 * Typed divert-target keys (kernelee `DispatchKey`) — the divert-side
 * vocabulary, next to the dispatch-side `SimActions` below for the same
 * reason: a pre-minted, typed token is plain data and belongs in contract.
 *
 * A `DispatchKey<P>` is to `divert` what a `KernelSymbol` is to `call`: the
 * token one side declares (`divertsTo: { toggle: SimFlowKeys.toggleCell }` in
 * circuit/sim/stroke.ts) and the other side binds
 * (`builder.flow(SimFlowKeys.toggleCell, …, togglePipe)` in driver/wiring.ts),
 * with tsc pinning the payload type on both ends. The key STRING is
 * deliberately `SimPort.toggleCell.id` — the same string the wiring catalog
 * already keys togglePipe under — so the typed tier changes nothing in the
 * projected wiring graph (divertedFrom edges, catalog keys, allowlists);
 * it only adds the compile-time payload check and the kernel-level binding
 * that the free-string tier never had. `strokeMove` follows the same
 * port-id-reuse shape: `SimPort.strokeMove.id`, because the flow-bound pipe
 * IS strokeMovePipe itself — strokeStart diverts here to have the start
 * point interpreted as the first move (circuit/sim/strokeMove.bridge.ts).
 * Reusing a GATE-GUARDED port's id as a flow key is a first for this app —
 * the `toggleCell` precedent above guards nothing — and it is safe for a
 * structural reason, not a coincidence: a gate folds into the SYMBOL's
 * handler table at `build()` time, while `flow()` populates the DIVERT-
 * resolution table; the two tables never intersect, so a divert (key → pipe
 * directly) never invokes the symbol handler and therefore never runs the
 * gate (`guard:stroke.active`, circuit/sim/inStroke.gate.ts). A future reader
 * reusing a guarded port's id as a flow key should cite both precedents:
 * `toggleCell` (id reuse, no gate involved) and `strokeMove` (id reuse
 * across a gate, safe because gate and flow resolution never meet).
 *
 * `tickLoop` is typed too, unlike before: once the generation loop's
 * runtime-variable axis (granularity/board size) moved into `fork(symbol)`
 * (LifePort.partitionRanges → LifePort.stepIndexRange, a runtime-sized
 * fan-out over the SAME module-constant pipe — circuit/sim/tickLoop.ts), the
 * self-divert has exactly ONE static destination — a fixed, decisionless hop
 * (a Bridge part: circuit/sim/tickLoop.bridge.ts), not a per-(granularity,
 * size) pipe choice. There is no longer a free-string, type-free divert tier
 * "by design" case in this app — every divert target here is bound through
 * `builder.flow(...)`.
 *
 * `step` no longer diverts anywhere: its former one-shot hop into a separate
 * `stepOnce` pipe (`stepOnce.bridge.ts`, deleted) is superseded by referencing
 * the shared generation sequence directly as a port symbol
 * (`Circuit.Sim.advanceGeneration`, circuit/sim/advanceGeneration.ts) — a
 * symbol-composition edge, not a divert, so `SimFlowKeys` carries no
 * `stepOnce` entry any more.
 */
export const SimFlowKeys = {
  toggleCell: dispatchKey<CellCoord>(
    SimPort.toggleCell.id,
    'Flip the given cell dead/alive — the stroke saga diverts here per visited cell',
  ),
  strokeMove: dispatchKey<NormalizedPoint>(
    SimPort.strokeMove.id,
    'Interpret one stroke point (the shared visit-interpretation pipe) — strokeStart diverts here so the start point is interpreted as the first move',
  ),
  tickLoop: dispatchKey<void>(
    'Circuit.Sim.tickLoop',
    'The generation loop body — play\'s detached .spawn launcher and the loop\'s own lap-end both divert here (self-divert reentry)',
  ),
} as const;

/**
 * Action creators for SimPort — the vocabulary of the dispatching side
 * (presentation / app). Used redux-style: `dispatch(SimActions.setSpeed(30))`.
 * A creator is a pure function (data) that merely pairs a pre-built symbol with
 * a payload, so it belongs in contract.
 */
export const SimActions = actionsOf(SimPort);

/** Action creators for SettingsPort — same convention as SimActions. */
export const SettingsActions = actionsOf(SettingsPort);

/** Action creators for FaultsPort — same convention as SimActions. */
export const FaultsActions = actionsOf(FaultsPort);

/** Device type the Compute ring must implement. */
export type LifeDevice = CallableDeviceOf<typeof LifePort>;

/** Device type the Circuit ring's sim family must implement. */
export type SimDevice = CallableDeviceOf<typeof SimPort>;

/** Device type the Circuit ring's settings family must implement. */
export type SettingsDevice = CallableDeviceOf<typeof SettingsPort>;

/** Device type the Circuit ring's faults family must implement. */
export type FaultsDevice = CallableDeviceOf<typeof FaultsPort>;

/** Device type the Infrastructure ring must implement (implementation of SettingsStorePort). */
export type SettingsStoreDevice = CallableDeviceOf<typeof SettingsStorePort>;
