// tests/traceDump.test.ts — pins the trace-dump harness's load-bearing
// assumption in-memory (no disk I/O here; tests/traceDump.harness.ts is the
// actual file-writing harness): building the
// kernel with `makeKernel(infra, {})` (tracing on, DEFAULT sink, no custom
// onTrace) must populate the runtime `TraceState` buffer cell, with the
// shape kernelee-mcp-tools' arch_monitor depends on
// (`{entries: TraceEntry[]}`, each entry carrying symbolId/verb/span/id) and
// exactly one root span per flow (one `kernel.call` = one root, per
// kernel.ts's span-parentage doc comment).

import { TraceState } from '@s-age/kernelee';
import { describe, expect, it } from 'vitest';
import { SimPort } from '../src/contract/ports';
import { makeKernel } from '../src/driver/wiring';
import { makeSettingsStore, memoryStorage } from '../src/infrastructure/settingsStore';

describe('trace-dump harness — makeKernel(infra, {}) is the DEFAULT-sink tracing path', () => {
  it('kernel.call(SimPort.step) populates TraceState with a single-root, correctly-shaped trace', async () => {
    const { kernel } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) }, {});

    await kernel.call(SimPort.step);

    const dump = kernel.buffer.read(TraceState);
    expect(dump.entries.length).toBeGreaterThan(0);
    for (const entry of dump.entries) {
      expect(typeof entry.symbolId).toBe('string');
      expect(typeof entry.verb).toBe('string');
      expect(typeof entry.span.id).toBe('string');
      expect(typeof entry.id).toBe('number');
    }

    // The one call above is the flow's own root — its span has no parent —
    // and every other recorded entry (its pipe's own stages, if any) nests
    // under it, so there is exactly one root span in this dump.
    const roots = dump.entries.filter((entry) => entry.span.parentId === undefined);
    const rootSpanIds = new Set(roots.map((entry) => entry.span.id));
    expect(rootSpanIds.size).toBe(1);
  });

  it('makeKernel(infra) with no second argument at all still leaves tracing off (TraceState absent)', () => {
    // Regression guard for the makeKernel signature change: an omitted second
    // argument (every pre-existing call site — testKernel.ts, wiring.test.ts,
    // etc.) must keep behaving exactly as before (tracing false, no
    // TraceState cell allocated at all).
    const { kernel } = makeKernel({ settingsStore: makeSettingsStore(memoryStorage()) });
    expect(() => kernel.buffer.read(TraceState)).toThrow();
  });
});
