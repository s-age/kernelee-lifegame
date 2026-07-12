// circuit/sim/tickLoop.ts — tick loop saga.
//
// **divert**: a generation loop whose final tickLoopPipe stage diverts to the
// next lap. divert is iteration, not recursion (swap in the stage sequence and
// value, continue from index=0), so the stack stays O(1) no matter how many
// tens of thousands of generations run. The jump target is chosen at runtime
// from SimState.granularity — a granularity switch takes effect from the next
// lap as "runtime selection of the divert target".
//
// The launch rule (launchTickLoop) lives in running.mutator.ts — a Mutator that
// calls no symbols, just a buffer transition + fire-and-forget launch, sharing
// the LoopState.phase transition axis with play/pause.

import { pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { LoopState, SimState, type ForkGranularity } from '../../contract/states';
import { cachedPipe } from './cache';
import { appendGeneration } from './generation';
import { granularitySwitch } from './granularity.switch';
import { runningPhaseGate } from './runningPhase.switch';
import { CircuitSimKeys } from './wiringKeys';

/**
 * Wait 1000 / genPerSec ms. Sliced into 50ms pieces, re-checking
 * LoopState.phase per slice so pause responds promptly (even at slow settings,
 * pause takes effect within ~50ms).
 */
async function sleepForSpeed(kernel: Kernel): Promise<void> {
  const { genPerSec } = kernel.buffer.read(SimState);
  const totalMs = 1000 / Math.max(genPerSec, 0.001);
  const deadline = Date.now() + totalMs;
  let remaining: number;
  while ((remaining = deadline - Date.now()) > 0) {
    if (kernel.buffer.read(LoopState).phase !== 'running') return; // pause responsiveness: discard the remaining time
    await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
  }
}

const tickLoopPipes = new Map<string, Pipe<void, void>>();

/**
 * The generation loop body. gate → one generation → sleep → granularitySwitch
 * (divert to the next lap).
 *
 * The entry gate is a Switch part (runningPhase.switch.ts). The final stage is
 * also a Switch part (granularity.switch.ts) — it reads SimState.granularity
 * and diverts to the corresponding loop pipe. The divert target is decided at
 * runtime (StageDescriptor.divertsTo is the author's declaration of the
 * candidates), so a granularity switch takes effect from the next lap even
 * while running.
 */
export function tickLoopPipeFor(
  granularity: ForkGranularity,
  width: number,
  height: number,
): Pipe<void, void> {
  return cachedPipe(tickLoopPipes, granularity, width, height, () =>
    appendGeneration(
      pipeline(
        { note: 'Phase gate (abort unless running = natural stop, settling the phase on idle)' },
        runningPhaseGate,
      ),
      granularity,
      width,
      height,
    )
      .effect(sleepForSpeed)
      .pipe(
        { note: 'Continue to the next generation (divert target selected at runtime by granularity)', divertsTo: [CircuitSimKeys.tickLoop] },
        granularitySwitch,
      )
      .seal(),
  );
}
