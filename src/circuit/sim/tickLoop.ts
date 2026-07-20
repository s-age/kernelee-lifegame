// circuit/sim/tickLoop.ts — tick loop saga (module constant).
//
// **divert**: a generation loop whose final stage diverts back into this
// very pipe (self-divert reentry) via the typed `SimFlowKeys.tickLoop` key.
// divert is iteration, not recursion (swap in the stage sequence and value,
// continue from index 0), so the stack stays O(1) no matter how many tens of
// thousands of generations run.
//
// Runtime *variability* (this app's other showcase primitive) now lives
// entirely in `fork(symbol)`: advanceGenerationPipe's fork fans
// `LifePort.stepIndexRange` out over a Compute-computed, runtime-sized range
// list (`LifePort.partitionRanges`, reading SimState.granularity + the board
// size on every lap) — so the self-divert itself is a FIXED, decisionless
// hop (tickLoop.bridge.ts), not a choice among per-(granularity, board size)
// pipe variants the way it used to be.
//
// The launch is a `.spawn` untracked fork branch in play.ts (play saga); the
// detached branch play spawns diverts into this SAME typed key
// (tickLoop.bridge.ts is shared by both call sites).

import { pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { SimFlowKeys, SimPort } from '../../contract/ports';
import { LoopState, SimState } from '../../contract/states';
import { runningPhaseSwitch } from './runningPhase.switch';
import { tickLoopBridge } from './tickLoop.bridge';

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

/**
 * The generation loop body — switch → one generation (referenced as the
 * `Circuit.Sim.advanceGeneration` symbol; internally a fork(symbol) fan-out,
 * runtime-sized) → sleep → bridge (self-divert reentry). A plain module
 * constant: unlike the old per-(granularity, board size) variant pipes, this
 * single `Pipe` value answers every lap regardless of granularity/board
 * size — both are read at runtime INSIDE advanceGenerationPipe's own stages
 * (the PartitionInput assembly stage in advanceGeneration.ts), not baked in
 * at construction.
 *
 * The entry switch is a Switch part (runningPhase.switch.ts) — it decides
 * AND self-terminates the loop (the aborting branch settles LoopState on
 * idle, inseparably — a pre-handler gate could not express a decision that
 * also self-terminates the pipe), so it stays an in-pipe stage, not a gate.
 * The generation itself is composed via `.tap(SimPort.advanceGeneration)` —
 * a mid-pipe symbol stage (through `kernel.invoke`, not the dispatch bus):
 * the cursor stays void afterward, so the pipe continues on to sleep/divert.
 * The final stage is a Bridge part (tickLoop.bridge.ts) — a fixed hop back
 * into this very pipe, reused by play.ts's `.spawn` launcher for the loop's
 * first lap.
 */
export const tickLoopPipe: Pipe<void, void> = pipeline(
  { note: 'running?' },
  runningPhaseSwitch,
)
  .tap(SimPort.advanceGeneration)
  .effect(sleepForSpeed)
  .pipe(
    { note: 'Continue to the next generation (self-divert reentry)', divertsTo: { tickLoop: SimFlowKeys.tickLoop } },
    tickLoopBridge,
  )
  .seal();
