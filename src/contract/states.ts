// contract/states.ts — Buffer state definitions (the single source of observable state)
//
// ★ Vite HMR note: `defineState` keeps a module-global uniqueness registry, so
// re-executing this module under HMR throws `duplicateStateId`.
// Never make contract an HMR boundary — the contractFullReload plugin in
// vite.config.ts demotes edits under src/contract/ to a full reload.
// If you remove the plugin, reload manually after editing contract.

import { defineState } from '@s-age/kernelee';

/** Default board size (the phase-2 UI also starts from these initial values). */
export const DEFAULT_WIDTH = 64;
export const DEFAULT_HEIGHT = 48;

/**
 * One board. `cells` is row-major 0/1 (index = y * width + x).
 * Torus boundaries (edges wrap) are the responsibility of the Compute rule implementation.
 *
 * Mutations follow a copy-on-write convention: never mutate `cells` in place and
 * return it (always build a new Uint8Array — if the reference does not change,
 * React's change detection breaks). The flip side is also a convention: **when
 * the value does not change, return the current reference as-is** (a new
 * reference signals "changed", so swapping the reference on a no-op write makes
 * subscribers' change detection fire spuriously).
 */
export interface Grid {
  readonly cells: Uint8Array;
  readonly width: number;
  readonly height: number;
  /**
   * Generation counter (`++` in advanceGeneration.ts, reset to `0` in randomize.ts).
   * Recorded requirement, unimplemented: the static scan's `readsState`/
   * `writesState` resolve at state granularity (`"GridState"`) and do not
   * distinguish `cells`/`width`/`height`/`generation` — the lack of per-field
   * granularity is only recorded here. Whether to close the gap (implement
   * sub-field resolution) is an owner decision; it is deliberately left
   * unimplemented to avoid over-application.
   */
  readonly generation: number;
}

/**
 * Fork granularity — how many branches one generation's computation fans out into.
 * 'chunk' = CHUNK_COUNT row chunks / 'row' = one branch per row /
 * 'cell' = one branch per cell (the degenerate form of "cell = pipeline").
 * A showcase axis for feeling the granularity-vs-overhead trade-off.
 */
export type ForkGranularity = 'chunk' | 'row' | 'cell';

/** Number of splits at 'chunk' granularity (vocabulary shared by the UI display and the circuit's split formula). */
export const CHUNK_COUNT = 4;

/** Simulation settings. The running state itself lives in LoopState (below). */
export interface Sim {
  /** Generations per second (the tick loop's sleep derives its wait time from this). */
  readonly genPerSec: number;
  /** Fork granularity. The tick loop picks its divert target every lap, so switching while running takes effect from the next lap. */
  readonly granularity: ForkGranularity;
}

/**
 * Running phase of the tick loop. "Wants to run" and "is actually running" are
 * not two independent booleans but two views of the same causality, so they are
 * unified into a single three-valued phase:
 * - `'idle'` — no loop.
 * - `'running'` — loop in flight.
 * - `'stopping'` — paused, but the loop itself has not yet noticed at the next
 *   lap's gate (a window in which the next play can flip the same loop back to
 *   'running' and reuse it — no double start).
 */
export type LoopPhase = 'idle' | 'running' | 'stopping';

export interface Loop {
  readonly phase: LoopPhase;
}

/** Cell coordinate on the board (0-origin). For Stroke (below) to keep it in a
 * Buffer it must live here, ahead of HitCellInput etc. in contract/ports.ts
 * (ports.ts imports from this module, so importing the other way would create
 * a cycle). */
export interface CellCoord {
  readonly x: number;
  readonly y: number;
}

/**
 * Stroke-interpretation state. `active` means "a stroke is in progress" — a
 * Buffer always holds a value, so it is needed to distinguish "not started"
 * from "started but no cell touched yet (last: null)".
 */
export interface Stroke {
  readonly active: boolean;
  readonly last: CellCoord | null;
}

export const GridState = defineState<Grid>('GridState', {
  cells: new Uint8Array(DEFAULT_WIDTH * DEFAULT_HEIGHT),
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  generation: 0,
});

export const SimState = defineState<Sim>('SimState', {
  genPerSec: 10,
  granularity: 'chunk',
});

export const LoopState = defineState<Loop>('LoopState', { phase: 'idle' });

export const StrokeState = defineState<Stroke>('StrokeState', { active: false, last: null });

/**
 * Statistics of the most recent board transition. A generation tick, toggleCell,
 * and randomize are all "transitions", and every pipeline/handler that writes
 * GridState emits this alongside, always as a pair (single writer).
 *
 * births/deaths are transition quantities that cannot be computed without the
 * before/after board pair, so they do not violate the "no derived values in
 * Buffers" convention. alive is derivable from the current board, but this
 * demo's policy is "emit whatever the pipeline can emit" — ship it as part of
 * the transition stats instead of making the view scan the board.
 */
export interface Stats {
  readonly alive: number;
  readonly births: number;
  readonly deaths: number;
}

export const StatsState = defineState<Stats>('StatsState', {
  alive: 0,
  births: 0,
  deaths: 0,
});

/** Same shape as the framework's KernelErrorValue — the two cells are twins
 *  split by audience (developer vs end user). */
export interface WiringDefect {
  readonly message: string | null;
}

/** The developer-facing twin of KernelErrorState: miswired (KernelError) faults
 *  land here, domain failures there. This app deliberately renders NO UI for
 *  this cell — an app that wants a visible surface for kernelee-origin wiring
 *  defects reads this cell. */
export const WiringDefectState = defineState<WiringDefect>('WiringDefectState', { message: null });
