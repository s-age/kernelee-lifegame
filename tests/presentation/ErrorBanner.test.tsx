// tests/presentation/ErrorBanner.test.tsx — renders the seeded KernelErrorState
// message; dismiss dispatches Circuit.Faults.clearError over the real wiring,
// and the banner disappears once the write lands (dispatch is async, so poll).

import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { KernelErrorState } from '@s-age/kernelee';
import { KernelProvider } from '@s-age/react-kernelee';
import { makeTestKernel } from '../testKernel';
import { ErrorBanner } from '../../src/presentation/ErrorBanner';
import { until } from './support';

test('shows the seeded message and dismiss clears it via the real wiring', async () => {
  const kernel = makeTestKernel();
  kernel.buffer.mutate(KernelErrorState, () => ({ message: 'boom' }));

  render(
    <KernelProvider kernel={kernel}>
      <ErrorBanner />
    </KernelProvider>,
  );

  expect(screen.getByRole('alert').textContent).toContain('boom');

  fireEvent.click(screen.getByLabelText('dismiss'));

  await until(() => kernel.buffer.read(KernelErrorState).message === null);
  await until(() => screen.queryByRole('alert') === null);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('message === null renders nothing', () => {
  const kernel = makeTestKernel();
  expect(kernel.buffer.read(KernelErrorState).message).toBeNull();

  render(
    <KernelProvider kernel={kernel}>
      <ErrorBanner />
    </KernelProvider>,
  );

  expect(screen.queryByRole('alert')).toBeNull();
});
