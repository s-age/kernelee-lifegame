// driver/wiring.ts — the wiring manifest. The single place where every device is wired.

import { BufferBuilder, KernelBuilder, type Kernel, type PipeDescriptorEntry, type TraceSink } from '@s-age/kernelee';
import { LifePort, SettingsPort, SettingsStorePort, SimFlowKeys, SimPort, type SettingsStoreDevice } from '../contract/ports';
import { GridState, LoopState, SimState, StatsState, StrokeState } from '../contract/states';
import { lifeDevice } from '../compute/device';
import { settingsDevice } from '../circuit/settings';
import { simDevice } from '../circuit/sim';
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
  const kernel = builder.build(devtools ? { buffer, tracing: true, onTrace: devtools.onTrace } : { buffer });
  return { kernel, boundSymbolIds, flowCatalog };
}
