import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// @testing-library/react does not auto-cleanup under vitest (that hook is
// jest-specific) — unmount every rendered tree after each test so listeners
// registered by one test's useBuffer/useSyncExternalStore subscriptions
// cannot leak into the next (react-kernelee's own tests/setup.ts idiom).
afterEach(() => {
  cleanup();
});
