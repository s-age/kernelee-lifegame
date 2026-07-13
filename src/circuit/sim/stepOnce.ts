// circuit/sim/stepOnce.ts — stepOnce saga (the same one generation as the loop body, for exactly one lap).
//
// The launch is a `divert` in step.ts (step saga): `step`'s pipe diverts here
// via stepGranularity.switch.ts, choosing the size/granularity-specific
// instance at runtime — the same "divert target selected at runtime" shape as
// tickLoop.ts, but staying ON the serial CommandBus (divert, not `.spawn`) so
// rapid Step clicks keep serializing. See step.ts's doc comment for the full
// divert-vs-spawn reasoning.

import { pipeline, type Pipe } from '@s-age/kernelee';
import type { ForkGranularity } from '../../contract/states';
import { cachedPipe } from './cache';
import { appendGeneration, type GenerationResult } from './generation';
import { idlePhaseGate } from './idlePhase.switch';

const stepOncePipes = new Map<string, Pipe<void, GenerationResult>>();

/**
 * A pipe that runs the same one-generation stage sequence as the loop body for
 * exactly one lap, with no sleep / divert. `Circuit.Sim.step` (step.ts)
 * diverts into the one for the current granularity (the result is
 * discarded). The entry gate is a Switch part (idlePhase.switch.ts).
 */
export function stepOncePipeFor(
  granularity: ForkGranularity,
  width: number,
  height: number,
): Pipe<void, GenerationResult> {
  return cachedPipe(stepOncePipes, granularity, width, height, () =>
    appendGeneration(
      pipeline(
        { note: 'Step entry gate (abort unless idle — the invariant is owned by circuit)' },
        idlePhaseGate,
      ),
      granularity,
      width,
      height,
    ).seal(),
  );
}
