// driver/wiring.ts — the wiring manifest. The single place where every device is wired.

import { BufferBuilder, KernelBuilder, KernelError, KernelErrorState, type Buffer, type GuardCatalogEntry, type Kernel, type PipeDescriptorEntry, type TraceSink } from '@s-age/kernelee';
import { LifePort, SettingsPort, SettingsStorePort, SimFlowKeys, SimPort, type SettingsStoreDevice } from '../contract/ports';
import { GridState, LoopState, SimState, StatsState, StrokeState, WiringDefectState } from '../contract/states';
import { lifeDevice } from '../compute/device';
import { settingsDevice } from '../circuit/settings';
import { knownGranularityGateRef } from '../circuit/settings/knownGranularity.gate';
import { simDevice } from '../circuit/sim';
import { idlePhaseGateRef } from '../circuit/sim/idlePhase.gate';
import { inStrokeGateRef } from '../circuit/sim/inStroke.gate';
import { launchArmGateRef } from '../circuit/sim/launchArm.gate';
import { TICK_LOOP_LAUNCH_NOTE } from '../circuit/sim/play';
import { togglePipe } from '../circuit/sim/toggleCell';

/**
 * The Infrastructure device that carries a runtime dependency (which storage).
 * Unlike the Compute / Circuit devices this is a **required argument** — the
 * composition root assembles it via the factory and injects it (tests pass an
 * in-memory storage).
 */
export interface InfrastructureDevices {
  readonly settingsStore: SettingsStoreDevice;
}

/**
 * Wire a device to every port. The spec is the single denominator, so it is one
 * wire line per port — completeness is pinned in CI by WiringTests (the
 * boundSymbolIds smoke test).
 */
export function wireAllDevices(builder: KernelBuilder, infra: InfrastructureDevices): void {
  LifePort.wire(lifeDevice, builder);
  SimPort.wire(simDevice, builder);
  SettingsPort.wire(settingsDevice, builder);
  SettingsStorePort.wire(infra.settingsStore, builder);
}

/**
 * Bind every typed divert target (kernelee `DispatchKey`) to the pipe that
 * answers it — the divert-side half of the wiring manifest, kept next to
 * `wireAllDevices` because it is the same kind of statement (name → entity,
 * checked by tsc through the token's payload type).
 *
 * One `flow()` call does two things at once: it writes the key into the
 * kernel's divert-resolution table (what `diverts.toggle(cell)` in
 * cellVisit.switch.ts resolves against at runtime), and it records the same
 * `PipeDescriptorEntry` a `describePipe` call would into
 * `builder.flowCatalog` — which is why the title/note here must match the
 * hand-written toggleCell entry in circuit/wiringCatalog.ts verbatim
 * (tests/wiringCatalog.test.ts pins that equality; the hand entry must stay,
 * because kernelee-mcp-tools' static scan attributes per-endpoint facts by
 * the source-visible `describePipe` calls in `buildWiringCatalog`, in order).
 *
 * The tick loop's self-divert target is deliberately NOT bound here — its
 * pipe identity is runtime-parameterized (see granularity.switch.ts), so it
 * stays on the unchecked `diversion(pipe, payload)` tier.
 */
export function bindFlows(builder: KernelBuilder): void {
  builder.flow(
    SimFlowKeys.toggleCell,
    'Cell toggle (toggleCell)',
    togglePipe,
    'Toggles a single cell copy-on-write and pair-emits the transition stats. Also the divert target of the stroke saga.',
  );
  // Guards ride along with flows here (not only from makeKernel below): a
  // caller that reproduces this repo's wiring by hand while substituting one
  // device — tests/circuit.test.ts's `makeFaultyLoopKernel` swaps LifePort's
  // implementation but still calls `bindFlows` for "the rest of the wiring
  // manifest" — must still get every gate wired, or a veto that owns a
  // buffer write (launchArm's double-start guard) would silently vanish
  // rather than merely relocate. `KernelBuilder.guard` is idempotent per
  // `(target, gate)` pair, so a caller that also calls `bindGuards` directly
  // (as `makeKernel` does not need to, but safely could) pays no double cost.
  bindGuards(builder);
}

/**
 * Bind every declared gate to its guarded target — the pre-handler-veto half
 * of the wiring manifest, grouped by target (one `builder.guard(...)` block
 * per port). Fold order per target follows call order here (see
 * `KernelBuilder.guard`'s own doc comment); today every target has exactly
 * one gate, so order is not yet a live concern.
 */
export function bindGuards(builder: KernelBuilder): void {
  builder.guard(SimPort.play, launchArmGateRef);
  builder.guard(SimPort.step, idlePhaseGateRef);
  builder.guard(SimPort.strokeMove, inStrokeGateRef);
  builder.guard(SettingsPort.setGranularity, knownGranularityGateRef);
}

/**
 * The composition root's `onError` policy — the APP-DOMAIN half of tick-loop
 * fault recovery. When `play`'s detached `.spawn` branch (the generation loop)
 * faults, kernelee routes the failure here (a `.spawn`ed branch's error sink is
 * the kernel's `onError`), tagged with the fork stage's note as `source`
 * (`TICK_LOOP_LAUNCH_NOTE`). This replaces the framework default sink, so it
 * must reproduce that sink's `KernelErrorState` write AND add the app recovery
 * the framework can't own: reset `LoopState → idle` so the UI's Play control
 * re-arms (the recovery half of the retired `settleTickLoopFault`).
 *
 * The LoopState reset is GATED on the loop's own source — a dispatched-command
 * failure (a failed `setSpeed` save, say) also reaches this sink, and must not
 * stop a running loop. `getBuffer` is a late-bound accessor for the kernel's
 * built buffer (the sink is created before `build()` returns the kernel, but
 * only ever CALLED at runtime, long after the buffer exists).
 *
 * The write also splits by audience: a `KernelError` (miswired — a wiring-time
 * programming bug) goes to `WiringDefectState`, the developer-facing surface;
 * everything else (a domain failure) goes to `KernelErrorState`, the
 * user-facing banner, as before.
 */
export function loopFaultSink(getBuffer: () => Buffer): (source: string, error: unknown) => void {
  return (source, error) => {
    if (source === TICK_LOOP_LAUNCH_NOTE) {
      getBuffer().mutate(LoopState, (loop) => (loop.phase === 'idle' ? loop : { phase: 'idle' as const })); // recovery is unconditional
    }

    if (error instanceof KernelError) {
      // Miswired (a wiring-time programming bug) goes to the DEVELOPER surface —
      // never to the domain-error surface (KernelErrorState → ErrorBanner).
      // This app renders no UI for WiringDefectState (silent by choice); the
      // write is kept live so tests can assert the split and the claim can't rot.
      console.error(`[wiring defect] ${source}:`, error);
      getBuffer().mutate(WiringDefectState, () => ({
        message: `${source}: [${error.code}] ${error.symbolId} — ${error.message}`,
      }));
      return;
    }

    // Domain failure — the user-facing banner, as before. Keep the non-Error
    // normalization (an unknown can be thrown that isn't an Error).
    const message = error instanceof Error ? error.message : String(error);
    getBuffer().mutate(KernelErrorState, () => ({ message: `${source}: ${message}` }));
  };
}

/**
 * Factory for the composition root: allocates state, wires every device, and
 * assembles the kernel. Tests use the same entry point (they run with the same
 * wiring as production).
 *
 * `trace` is the single master tracing switch (default undefined → tracing
 * stays at its default of false, preserving the "single master switch"
 * design). Passing it at all turns tracing on; its one field discriminates
 * WHICH sink records the trace — the two are mutually exclusive, mirroring
 * `KernelBuildOptions.onTrace`'s own "an injected sink replaces the default
 * entirely" rule:
 *   - `{ onTrace }` — the kernelee-devtools-bridge shape (main.tsx's only
 *     caller today): a custom sink forwards every traced call to the bridge's
 *     WS connection LIVE. This REPLACES the default sink, so the runtime
 *     `TraceState` buffer cell is never written on this path.
 *   - `{}` (onTrace omitted) — tracing on with the framework's DEFAULT sink,
 *     so `TraceState` IS populated. This is the path the headless
 *     trace-dump harness (tests/traceDump.harness.ts) uses: a one-shot dump
 *     has no live WS to forward to, and wants exactly the buffer-resident ring
 *     `kernel.buffer.read(TraceState)` exposes.
 *
 * `boundSymbolIds` is included in the return value so
 * `KernelBuilder.boundSymbolIds` (which only exists before build), needed for
 * the `projectWiringGraph` call, can be carried back to the caller (the
 * composition root) without wiring twice. `flowCatalog` rides along for the
 * same reason: it is the flow-binding table's own derived catalog (kernelee
 * guarantees a `flow()`-bound pipe cannot be wired without being catalogued),
 * which `mergeWiringCatalog` (circuit/wiringCatalog.ts) folds into the
 * projected catalog at the consumers. `guardCatalog` rides along for the same
 * reason again: `KernelBuilder.guardCatalog` only exists before `build()`
 * too, and `projectWiringGraph`'s v6 `guards` field is required, not
 * optional — the composition root has no other way to obtain it.
 */
export function makeKernel(
  infra: InfrastructureDevices,
  trace?: { onTrace?: TraceSink },
): {
  kernel: Kernel;
  boundSymbolIds: ReadonlySet<string>;
  flowCatalog: readonly PipeDescriptorEntry[];
  guardCatalog: readonly GuardCatalogEntry[];
} {
  const buffer = new BufferBuilder();
  buffer.allocate(GridState);
  buffer.allocate(SimState);
  buffer.allocate(StatsState);
  buffer.allocate(LoopState);
  buffer.allocate(StrokeState);
  buffer.allocate(WiringDefectState);

  const builder = new KernelBuilder();
  wireAllDevices(builder, infra);
  bindFlows(builder);
  const boundSymbolIds = builder.boundSymbolIds;
  const flowCatalog = builder.flowCatalog;
  const guardCatalog = builder.guardCatalog;
  // `loopFaultSink` needs the built buffer, which `build()` produces from the
  // `BufferBuilder` above; the sink closes over `() => kernel.buffer` (a const
  // captured by the closure, only invoked at fault time — never during build).
  const onError = loopFaultSink(() => kernel.buffer);
  // `trace.onTrace` being omitted (`undefined`) is passed straight through:
  // `KernelBuilder.build` falls back to its own default sink whenever
  // `options.onTrace` is `undefined` but `tracing` is `true` — there is no
  // need to branch on it here, only on `trace` itself (tracing on vs off).
  const kernel = builder.build(
    trace ? { buffer, tracing: true, onTrace: trace.onTrace, onError } : { buffer, onError },
  );
  return { kernel, boundSymbolIds, flowCatalog, guardCatalog };
}
