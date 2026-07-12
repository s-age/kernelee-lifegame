import { defineConfig } from 'vitest/config';

/**
 * Coexistence setup: the existing Compute/Circuit/Wiring tests stay in the node
 * environment, and only the UI tests (tests/presentation/**) use jsdom +
 * setupFiles (cleanup). setupFiles can only be scoped per project
 * (environmentMatchGlobs is a global setting, so it cannot scope setupFiles
 * along with it), hence the split via `test.projects`.
 */
export default defineConfig({
  // react-kernelee is a file: link and carries its own node_modules/react
  // (a devDependency for its own package's tests). Without dedupe, two React
  // instances coexist and fail with "Invalid hook call" — this one line is the fix.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/presentation/**'],
        },
      },
      {
        resolve: {
          dedupe: ['react', 'react-dom'],
        },
        test: {
          name: 'presentation',
          environment: 'jsdom',
          include: ['tests/presentation/**/*.test.{ts,tsx}'],
          setupFiles: ['./tests/presentation/setup.ts'],
        },
      },
    ],
  },
});
