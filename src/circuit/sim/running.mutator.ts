// circuit/sim/running.mutator.ts — Mutator part for LoopState.phase.
//
// Mutator: a part holding only pure buffer transitions that **call no symbols**.
// Making these pipes would add no symbol edges and put no information on the
// wiring graph, so they deliberately stay plain handlers (the dividing line
// with sagas: calls a symbol → pipe, does not → Mutator).
//
// `pause` is the sole resident: a single LoopState transition, no launch, no
// symbol. `play` graduated to a saga (play.ts) when its launch became a
// first-class `.spawn` untracked fork branch — the detached-fork-branch arc's
// culmination — so the old `launchTickLoop` fire-and-forget helper and its
// `settleTickLoopFault` cleanup (which manually wrote KernelErrorState) are
// both gone: a `.spawn`ed branch's failure routes to the framework errorSink,
// and the app-domain LoopState→idle recovery moved to the composition root's
// `onError` policy (driver/wiring.ts).

import { type Kernel } from '@s-age/kernelee';
import { LoopState } from '../../contract/states';

/** Set 'stopping' only while 'running' — the next lap's gate aborts, drops to
 * idle, and the loop stops naturally. Already 'idle'/'stopping': do nothing. */
export function pause(kernel: Kernel): void {
  kernel.buffer.mutate(LoopState, (loop) => (loop.phase === 'running' ? { phase: 'stopping' as const } : loop));
}
