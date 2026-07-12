import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Plugin that keeps contract/ from becoming an HMR boundary.
 *
 * `defineState` / `defineCallable` keep module-global uniqueness registries
 * (a duplicate id throws at mint time). If a contract module re-executes under
 * HMR, the same id would be minted twice and crash with `duplicateStateId` /
 * `duplicateSymbolId`. Edits under contract are demoted to a full reload
 * (page reload = the registries reset with it).
 */
function contractFullReload(): Plugin {
  return {
    name: 'lifegame:contract-full-reload',
    handleHotUpdate({ file, server }) {
      if (file.includes('/src/contract/')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), contractFullReload()],
  // react-kernelee is a file: link (symlink) and carries its own
  // node_modules/react as a devDependency for its own tests. Without dedupe,
  // react-kernelee's hooks grab a different React instance and fail with
  // "Invalid hook call" (same reason and same fix as vitest.config.ts).
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
});
