// circuit/sim/play.ts — play saga.
//
// **detached fork (`.spawn`)** — the culmination of the detached-fork-branch
// arc. `play`'s double-start guard now runs as a framework GATE
// (`guard:loop.launchArm`, circuit/sim/launchArm.gate.ts) BEFORE this pipe
// even starts — see driver/wiring.ts's `bindGuards` — so `playPipe` itself
// opens with a minimal entry stage and LAUNCHES the generation loop as an
// UNTRACKED fork branch: a first-class `.spawn` stage on the wiring graph,
// NOT the old `void kernel.run(tickLoopPipeFor(...)).catch(settleTickLoopFault)`
// escape.
//
// What the ORIGINAL migration (to `.spawn`) bought:
// - the imperative `kernel.run().catch()` is gone — the launch is an
//   architectural stage, and the spawn's untracked branch is a visible edge
//   from `play` to the loop (resolving tickLoop's orphan — see
//   scripts/wiringIssueAllowlist.ts);
// - the manual `KernelErrorState` write is gone — a `.spawn`ed branch's failure
//   routes to the framework `errorSink` automatically. The app-domain half
//   (LoopState → idle so the UI's Play control re-arms) lives in the
//   composition root's `onError` policy (driver/wiring.ts), matched by the
//   shared `TICK_LOOP_LAUNCH_NOTE` source label below.
//
// What THIS migration (the double-start guard: pipe-entry Switch → gate)
// bought: the veto is now enforced at the `Circuit.Sim.play` call boundary
// itself, not merely at this pipe's first stage — a future second entry point
// into `playPipe` (there is none today) could not accidentally bypass it.

import { next, pipeline, type Kernel, type Pipe } from '@s-age/kernelee';
import { granularitySwitch } from './granularity.switch';
import { CircuitSimKeys } from './wiringKeys';

/**
 * The `.spawn` stage's note — and, because kernelee derives a detached branch's
 * error-sink `source` from the fork stage's note (`note ?? 'fork.untracked'`),
 * ALSO the label a tick-loop fault arrives under. Shared with driver/wiring.ts's
 * `onError` policy so LoopState recovery matches exactly this source and no
 * unrelated command fault stops a running loop.
 */
export const TICK_LOOP_LAUNCH_NOTE = 'Launch the generation loop (detached — fire-and-forget)';

/**
 * The play saga: a minimal entry stage (the double-start guard already ran as
 * this pipe's guarding gate — see file header) then `.spawn` the detached
 * generation loop. `.spawn` forwards the void cursor, so the saga's output
 * stays void; the spawned launcher outlives the run (a non-terminating
 * self-diverting loop).
 */
export const playPipe: Pipe<void, void> = pipeline(
  { note: 'Enter play (the double-start guard already ran as the guarding gate — guard:loop.launchArm)' },
  (_kernel: Kernel, _payload: void) => next(),
)
  .spawn(
    { note: TICK_LOOP_LAUNCH_NOTE },
    // The detached launcher branch, inline at the spawn site: a one-stage pipe
    // that raw-diverts into the size-specific generation loop — the same
    // UNCHECKED size axis as the loop's own re-arm (granularity.switch.ts),
    // reusing `granularitySwitch` (read granularity + board-size → `divert`
    // into `tickLoopPipeFor`). It declares `divertsTo: [tickLoop]` so play's
    // spawn edge to the loop is a visible graph edge — folding it gives
    // tickLoop an EXTERNAL referrer (`play`), which is what resolves tickLoop's
    // former orphanEntry. A loop failure propagates out of this branch's
    // `runStages` to the `.spawn`'s errorSink (the composition root's
    // `onError`: LoopState → idle + KernelErrorState); a self-diverting loop
    // has no in-pipe fail-tail (it replaces its own stage list each lap), so
    // the detached-branch boundary is the only place to catch it.
    pipeline(
      { note: 'Enter the generation loop (divert target selected at runtime by granularity)', divertsTo: [CircuitSimKeys.tickLoop] },
      granularitySwitch,
    ).seal(),
  )
  .seal();

/** One-line delegate — device.ts stays a zero-logic catalog. */
export function play(kernel: Kernel): Promise<void> {
  return kernel.run(playPipe);
}
