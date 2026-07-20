// circuit/faults/kernelError.mutator.ts — Mutator part for KernelErrorState.
//
// Mutator: a part holding only pure buffer transitions that **call no
// symbols**. `clearError` calls no symbol, so it stays a plain handler (the
// dividing line with sagas: calls a symbol → pipe, does not → Mutator) — the
// same shape as running.mutator.ts's `pause`.
//
// This is the displaying view's own write path, per kernelee's buffer.ts doc
// for KernelErrorState: the default error sink only ever WRITES the cell; a
// sink never clears it. Clearing is the app's job, through its normal write
// path — ErrorBanner dispatches Circuit.Faults.clearError, and this handler
// mutates the cell back to `{ message: null }`.
//
// WiringDefectState is deliberately NOT cleared here — it has no display UI
// (silent by choice, see driver/wiring.ts's loopFaultSink), so there is no
// view to drive a clear, and no contract obligation to clear it.

import { type Kernel, KernelErrorState } from '@s-age/kernelee';

/** Clear KernelErrorState back to { message: null }. Already null: no-op (CoW — returns the same reference). */
export function clearError(kernel: Kernel): void {
  kernel.buffer.mutate(KernelErrorState, (cur) => (cur.message === null ? cur : { message: null }));
}
