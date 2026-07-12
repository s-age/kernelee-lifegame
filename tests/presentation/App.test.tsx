// tests/presentation/App.test.tsx — smoke test: App renders under
// KernelProvider (the same wiring as production + an in-memory settings store).

import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { KernelProvider } from '@s-age/react-kernelee';
import { makeTestKernel } from '../testKernel';
import { App } from '../../src/presentation/App';

test('App renders under KernelProvider without throwing', () => {
  const kernel = makeTestKernel();

  const { container } = render(
    <KernelProvider kernel={kernel}>
      <App />
    </KernelProvider>,
  );

  expect(container.querySelector('.app')).not.toBeNull();
  expect(container.querySelector('canvas.grid-canvas')).not.toBeNull();
});
