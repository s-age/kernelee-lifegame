// circuit/sim/advanceGeneration.ts — the stage sequence for one generation,
// bound to the port symbol `Circuit.Sim.advanceGeneration`.
//
// **Predefined process, referenced by symbol — not an appender.** This stage
// sequence used to be `appendGeneration<I>(entry)`, a function that copied
// the same stages onto whichever `PipeBuilder` its two callers (tickLoop /
// stepOnce) passed in — a construction-time DRY device, not a graph edge.
// This file now owns the sequence as ONE module-constant pipe
// (`advanceGenerationPipe`), wired to the port symbol
// `Circuit.Sim.advanceGeneration` (`portK<void, void>`, contract/ports.ts).
// tickLoop and step no longer build a copy of these stages; they COMPOSE
// this pipe as a symbol stage — tickLoop via
// `.tap(SimPort.advanceGeneration)` (mid-pipe: the cursor continues to the
// sleep/divert stages after), step via `pipeline(SimPort.advanceGeneration)`
// (the symbol IS the whole pipe — step has no further stage of its own).
// Both compositions run through `kernel.invoke`, the same chokepoint
// `.pipe(sym)`/`.tap(sym)` always use — direct, not through the serial
// dispatch bus — so neither risks a bus-reentrancy deadlock.
//
// **Symbol-composition edges must stay a DAG.** A pipe may reference another
// circuit port symbol as a stage (as tickLoop/step do here), but never in a
// cycle — a cycle is the divert tier's exclusive job (tickLoop's own
// self-divert reentry is the legitimate example; that hop is a typed
// `divertsTo`, not a symbol stage). This file's own stages call only
// `LifePort.*` (Compute, a leaf) and no other `Circuit.Sim.*` symbol, so it
// cannot itself close a cycle.
//
// **Verb containment has two layers, and they behave differently.** (1) A
// verb produced INSIDE this pipe (an `abort`/`divert`/`fail` from one of its
// own stages) is contained by `kernel.run`'s forward-only contract: `run`
// discards whatever the final verb was and resolves to `Promise<void>` once
// the run completes — the composing stage (tickLoop's `.tap`, step's
// `.pipe`) only ever sees `next(undefined)` on success, or a thrown error on
// `fail`. (2) A GATE's verb does NOT get this containment: a gate folds into
// the SYMBOL's own handler at `KernelBuilder.build()` time, so its
// abort/divert/fail surfaces as the composing stage's OWN verb at the
// `kernel.invoke` boundary — terminating or redirecting the CALLER's flow
// (tickLoop's or step's), not just this pipe's.
//
// **Consequently: never guard `Circuit.Sim.advanceGeneration` with a gate**,
// least of all an idlePhase-shaped one. tickLoop's own `.tap` runs this
// symbol every lap WHILE `LoopState.phase === 'running'` — a gate that vetoes
// on anything but `idle` would abort tickLoop's own flow from inside its own
// lap. Should a veto ever be needed here, it must be expressed as a typed
// `fail` (or a `divert` to an explicit recovery pipe) whose contract is
// declared in this symbol's own `contract/ports.ts` description — never a
// silent `abort`.

import { next, pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { LifePort, type DiffStatsInput, type PartitionInput } from '../../contract/ports';
import { GridState, SimState, type Stats } from '../../contract/states';
import { mergeGranularityBranches, packGenerationResult } from './advanceGeneration.emitter';
import { applyGenerationResult } from './advanceGeneration.mutator';

/** The product of one generation — the joined board + transition stats. The effect emits to both states. */
export interface GenerationResult {
  readonly cells: Uint8Array;
  readonly stats: Stats;
}

/**
 * One generation's worth of "snapshot → partition (symbol) → fork (symbol,
 * runtime-sized) → Emitter (join) → fork (board line / stats line) → write".
 *
 * Granularity AND board size are read from the buffer on every call, not
 * baked in at construction time: this is a plain module constant (no
 * per-(granularity, board size) variant pipes) — the fork's runtime-sized
 * fan-out (`.fork(LifePort.stepIndexRange)`, fed by `LifePort.partitionRanges`)
 * is what absorbs that axis.
 *
 * The downstream effect needs both the new board and the stats — the board
 * travels on a pass-through line, the stats on the diffStats line, and the
 * Emitter (`.map`) hands both to the next stage.
 */
export const advanceGenerationPipe: Pipe<void, GenerationResult> = pipeline(
  { note: 'Take a board snapshot (buffer read)' },
  (kernel: Kernel, _cursor: void) => next(kernel.buffer.read(GridState)),
)
  .pipe({ note: 'Assemble PartitionInput (granularity via buffer read)' }, (kernel, grid) =>
    next<PartitionInput>({
      cells: grid.cells,
      width: grid.width,
      height: grid.height,
      granularity: kernel.buffer.read(SimState).granularity,
    }),
  )
  .pipe(LifePort.partitionRanges)
  .fork(LifePort.stepIndexRange)
  .map(mergeGranularityBranches)
  .pipe({ note: 'Assemble the transition pair (the previous generation is still in the pre-write buffer)' }, (kernel, merged) =>
    next({ prev: kernel.buffer.read(GridState).cells, next: merged }),
  )
  .fork(
    pipeline({ note: 'Board line — pass the new board through' }, (_kernel: Kernel, pair: DiffStatsInput) =>
      next(pair.next),
    ),
    pipeline({ note: 'Stats line — distribute the transition pair' }, (_kernel: Kernel, pair: DiffStatsInput) =>
      next(pair),
    ).pipe(LifePort.diffStats),
  )
  .map(packGenerationResult) // Emitter part (advanceGeneration.emitter.ts): hands both to the next stage (repacking only)
  .effect(applyGenerationResult) // Mutator part (advanceGeneration.mutator.ts): buffer write only
  .seal();

/**
 * One-line delegate — device.ts stays a zero-logic catalog. `kernel.run`
 * discards the pipe's own `GenerationResult` cursor (forward-only: results
 * are observed via the buffer, never returned), so this always resolves
 * `Promise<void>` regardless of `advanceGenerationPipe`'s own `O`.
 */
export function advanceGeneration(kernel: Kernel): Promise<void> {
  return kernel.run(advanceGenerationPipe);
}
