// tests/presentation/ControlBar.test.tsx — Pause is disabled at phase='idle' /
// pressing Play flips LoopState.phase to 'running' (observed by polling).

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { KernelProvider } from '@s-age/react-kernelee';
import { SimPort } from '../../src/contract/ports';
import { LoopState, SimState } from '../../src/contract/states';
import { makeTestKernel } from '../testKernel';
import { ControlBar } from '../../src/presentation/ControlBar';
import { until } from './support';

test("at phase='idle' Pause is disabled and Play/Step are enabled", () => {
  const kernel = makeTestKernel();
  expect(kernel.buffer.read(LoopState).phase).toBe('idle');

  render(
    <KernelProvider kernel={kernel}>
      <ControlBar />
    </KernelProvider>,
  );

  // @testing-library/jest-dom is not installed, so disabled is checked as the plain DOM property.
  expect(screen.getByText('⏸ Pause')).toHaveProperty('disabled', true);
  expect(screen.getByText('▶ Play')).toHaveProperty('disabled', false);
  expect(screen.getByText('⏭ Step')).toHaveProperty('disabled', false);
});

test('switching the Fork selector changes SimState.granularity (dispatch goes over the bus, so observe by polling)', async () => {
  const kernel = makeTestKernel();
  expect(kernel.buffer.read(SimState).granularity).toBe('chunk');

  render(
    <KernelProvider kernel={kernel}>
      <ControlBar />
    </KernelProvider>,
  );

  fireEvent.change(screen.getByLabelText('granularity'), { target: { value: 'cell' } });

  await until(() => kernel.buffer.read(SimState).granularity === 'cell');
  expect(kernel.buffer.read(SimState).granularity).toBe('cell');
});

test("pressing Play flips LoopState.phase to 'running' (dispatch goes over the bus, so observe by polling)", async () => {
  const kernel = makeTestKernel();

  render(
    <KernelProvider kernel={kernel}>
      <ControlBar />
    </KernelProvider>,
  );

  fireEvent.click(screen.getByText('▶ Play'));

  await until(() => kernel.buffer.read(LoopState).phase === 'running');
  expect(kernel.buffer.read(LoopState).phase).toBe('running');

  // Cleanup: stop the tick loop (self-divert + setTimeout) before finishing
  // (the kernel is fresh per test so nothing leaks, but never leave it running).
  await kernel.call(SimPort.pause);
});
