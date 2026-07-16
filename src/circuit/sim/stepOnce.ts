// circuit/sim/stepOnce.ts — stepOnce saga (the same one generation as the loop body, for exactly one lap).
//
// The launch is a `divert` in step.ts (step saga): `step`'s pipe diverts here
// via stepGranularity.switch.ts, choosing the size/granularity-specific
// instance at runtime — the same "divert target selected at runtime" shape as
// tickLoop.ts, but staying ON the serial CommandBus (divert, not `.spawn`) so
// rapid Step clicks keep serializing. See step.ts's doc comment for the full
// divert-vs-spawn reasoning.
//
// The idle-phase invariant ("never step while running") now runs as a
// framework GATE (`guard:loop.idle`, circuit/sim/idlePhase.gate.ts) guarding
// `Circuit.Sim.step` itself — BEFORE step.ts's stepGranularitySwitch even
// computes/looks up this pipe (see driver/wiring.ts's `bindGuards`), so this
// pipe's own entry stage is now a minimal pass-through, not the gate.

import { next, pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import type { ForkGranularity } from '../../contract/states';
import { cachedPipe } from './cache';
import { appendGeneration, type GenerationResult } from './generation';

const stepOncePipes = new Map<string, Pipe<void, GenerationResult>>();

/**
 * A pipe that runs the same one-generation stage sequence as the loop body for
 * exactly one lap, with no sleep / divert. `Circuit.Sim.step` (step.ts)
 * diverts into the one for the current granularity (the result is
 * discarded). The idle-phase invariant already ran as `Circuit.Sim.step`'s
 * guarding gate before this pipe was ever reached (circuit/sim/idlePhase.gate.ts).
 */
export function stepOncePipeFor(
  granularity: ForkGranularity,
  width: number,
  height: number,
): Pipe<void, GenerationResult> {
  return cachedPipe(stepOncePipes, granularity, width, height, () =>
    appendGeneration(
      pipeline(
        { note: 'Enter the one-lap step sequence (the idle-phase invariant already ran as the guarding gate — guard:loop.idle)' },
        (_kernel: Kernel, _payload: void) => next(),
      ),
      granularity,
      width,
      height,
    ).seal(),
  );
}
