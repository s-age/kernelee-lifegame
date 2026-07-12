// driver/wiring.ts — the wiring manifest. The single place where every device is wired.

import { BufferBuilder, KernelBuilder, type Kernel, type TraceSink } from '@s-age/kernelee';
import { LifePort, SettingsPort, SettingsStorePort, SimPort, type SettingsStoreDevice } from '../contract/ports';
import { GridState, LoopState, SimState, StatsState, StrokeState } from '../contract/states';
import { lifeDevice } from '../compute/device';
import { settingsDevice } from '../circuit/settings';
import { simDevice } from '../circuit/sim';

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
 * Factory for the composition root: allocates state, wires every device, and
 * assembles the kernel. Tests use the same entry point (they run with the same
 * wiring as production).
 *
 * `devtools` is an opt-in solely for the kernelee-devtools-bridge connection
 * (default undefined → tracing stays at its default of false, preserving the
 * "single master switch" design). `boundSymbolIds` is included in the return
 * value so `KernelBuilder.boundSymbolIds` (which only exists before build),
 * needed for the `projectWiringGraph` call, can be carried back to the caller
 * (the composition root) without wiring twice.
 */
export function makeKernel(
  infra: InfrastructureDevices,
  devtools?: { onTrace: TraceSink },
): { kernel: Kernel; boundSymbolIds: ReadonlySet<string> } {
  const buffer = new BufferBuilder();
  buffer.allocate(GridState);
  buffer.allocate(SimState);
  buffer.allocate(StatsState);
  buffer.allocate(LoopState);
  buffer.allocate(StrokeState);

  const builder = new KernelBuilder();
  wireAllDevices(builder, infra);
  const boundSymbolIds = builder.boundSymbolIds;
  const kernel = builder.build(devtools ? { buffer, tracing: true, onTrace: devtools.onTrace } : { buffer });
  return { kernel, boundSymbolIds };
}
