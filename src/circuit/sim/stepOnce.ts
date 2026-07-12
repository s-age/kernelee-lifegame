// circuit/sim/stepOnce.ts — stepOnce saga (the same one generation as the loop body, for exactly one lap).

import { pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { GridState, SimState, type ForkGranularity } from '../../contract/states';
import { cachedPipe } from './cache';
import { appendGeneration, type GenerationResult } from './generation';
import { idlePhaseGate } from './idlePhase.switch';

const stepOncePipes = new Map<string, Pipe<void, GenerationResult>>();

/**
 * A pipe that runs the same one-generation stage sequence as the loop body for
 * exactly one lap, with no sleep / divert. `Circuit.Sim.step` composes the one
 * for the current granularity (the result is discarded). The entry gate is a
 * Switch part (idlePhase.switch.ts).
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

/** Run the pipe for the current granularity and board size for one lap (result discarded — forward-only). */
export function stepOnce(kernel: Kernel): Promise<void> {
  const grid = kernel.buffer.read(GridState);
  const { granularity } = kernel.buffer.read(SimState);
  return kernel.run(stepOncePipeFor(granularity, grid.width, grid.height));
}
