// driver/wiring.ts — the wiring manifest. The single place where every device is wired.

import { BufferBuilder, KernelBuilder, KernelErrorState, type Buffer, type Kernel, type PipeDescriptorEntry, type TraceSink } from '@s-age/kernelee';
import { LifePort, SettingsPort, SettingsStorePort, SimFlowKeys, SimPort, type SettingsStoreDevice } from '../contract/ports';
import { GridState, LoopState, SimState, StatsState, StrokeState } from '../contract/states';
import { lifeDevice } from '../compute/device';
import { settingsDevice } from '../circuit/settings';
import { simDevice } from '../circuit/sim';
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
 */
export function loopFaultSink(getBuffer: () => Buffer): (source: string, error: unknown) => void {
  return (source, error) => {
    if (source === TICK_LOOP_LAUNCH_NOTE) {
      getBuffer().mutate(LoopState, (loop) => (loop.phase === 'idle' ? loop : { phase: 'idle' as const }));
    }
    // Reproduce the framework default sink's write (an injected onError replaces it entirely).
    const message = error instanceof Error ? error.message : String(error);
    getBuffer().mutate(KernelErrorState, () => ({ message: `${source}: ${message}` }));
  };
}

/**
 * Factory for the composition root: allocates state, wires every device, and
 * assembles the kernel. Tests use the same entry point (they run with the same
 * wiring as production).
 *
 * `devtools` is an opt-in solely for the kernelee-devtools-bridge connection
 * (default undefined → tracing stays at its default of false, preserving the
 * "single master switch" design). `boundSymbolIds` is included in the return
 * value so `KernelBuilder.boundSymbolIds` (which only exists before build),
 * needed for the `projectWiringGraph` call, can be carried back to the caller
 * (the composition root) without wiring twice. `flowCatalog` rides along for
 * the same reason: it is the flow-binding table's own derived catalog
 * (kernelee guarantees a `flow()`-bound pipe cannot be wired without being
 * catalogued), which `mergeWiringCatalog` (circuit/wiringCatalog.ts) folds
 * into the projected catalog at the consumers.
 */
export function makeKernel(
  infra: InfrastructureDevices,
  devtools?: { onTrace: TraceSink },
): { kernel: Kernel; boundSymbolIds: ReadonlySet<string>; flowCatalog: readonly PipeDescriptorEntry[] } {
  const buffer = new BufferBuilder();
  buffer.allocate(GridState);
  buffer.allocate(SimState);
  buffer.allocate(StatsState);
  buffer.allocate(LoopState);
  buffer.allocate(StrokeState);

  const builder = new KernelBuilder();
  wireAllDevices(builder, infra);
  bindFlows(builder);
  const boundSymbolIds = builder.boundSymbolIds;
  const flowCatalog = builder.flowCatalog;
  // `loopFaultSink` needs the built buffer, which `build()` produces from the
  // `BufferBuilder` above; the sink closes over `() => kernel.buffer` (a const
  // captured by the closure, only invoked at fault time — never during build).
  const onError = loopFaultSink(() => kernel.buffer);
  const kernel = builder.build(
    devtools ? { buffer, tracing: true, onTrace: devtools.onTrace, onError } : { buffer, onError },
  );
  return { kernel, boundSymbolIds, flowCatalog };
}
