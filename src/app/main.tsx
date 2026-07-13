// app/main.tsx — the composition root (phase 2: board UI via react-kernelee).
//
// Only this file knows driver (makeKernel) and KernelProvider. presentation
// depends only on contract + react-kernelee and knows nothing about kernel
// assembly.

// Import from the browser-facing `connector` subpath — the barrel (`.`) also
// re-exports `server.ts` (Node-only, depends on `node:path` etc.), and going
// through it makes the production build (Rollup) fail to resolve Node builtins.
import { connectDevtoolsBridge, type BridgeConnector } from '@s-age/kernelee-devtools-bridge/connector';
import { projectWiringGraph } from '@s-age/kernelee';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { KernelProvider } from '@s-age/react-kernelee';
import { mergeWiringCatalog } from '../circuit/wiringCatalog';
import { SettingsActions, SimActions } from '../contract/ports';
import { makeKernel } from '../driver/wiring';
import { makeSettingsStore } from '../infrastructure/settingsStore';
import { App } from '../presentation/App';
import '../presentation/style.css';

// The kernelee-devtools-bridge connection is a dev-only opt-in (it never
// happens in the production build or under `vitest run` — this module is not
// imported by tests). In ordinary dev where the bridge server simply is not
// running, a console.error would keep appearing on every retry, so only the
// first connection failure is logged, once.
let loggedBridgeError = false;
const bridge: BridgeConnector | undefined = import.meta.env.DEV
  ? connectDevtoolsBridge({
      onError: () => {
        if (loggedBridgeError) return;
        loggedBridgeError = true;
        console.debug('[kernelee-lifegame] could not connect to the devtools bridge (safe to ignore in normal development)');
      },
    })
  : undefined;

// Only the composition root knows Infrastructure's runtime dependency (which storage).
const { kernel, boundSymbolIds, flowCatalog } = makeKernel(
  { settingsStore: makeSettingsStore(window.localStorage) },
  bridge ? { onTrace: bridge.onTrace } : undefined,
);

if (bridge) {
  // Sent exactly once, based on the startup defaults (SimState.granularity:
  // 'chunk', DEFAULT_WIDTH/DEFAULT_HEIGHT) — there is no reliable way to wait
  // for the actual post-hydrate granularity (dispatch is fire-and-forget, and
  // on first launch hydrateSettings never touches SimState because of the null
  // gate), so this is accepted as a known limitation.
  // The catalog folds the flow-derived entries (builder.flowCatalog, carried
  // out of makeKernel) over the hand-built describePipe entries — see
  // mergeWiringCatalog's own doc comment for the dedupe/order rules.
  bridge.sendCatalog(projectWiringGraph(mergeWiringCatalog(flowCatalog), boundSymbolIds));
}

// Startup initialization (outside the view = the composition root, so calling
// dispatch directly is fine — presentation never does). dispatch is a serial
// bus, so the hydrate → randomize order is preserved.
kernel.dispatch(SettingsActions.hydrateSettings());
kernel.dispatch(SimActions.randomize());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KernelProvider kernel={kernel}>
      <App />
    </KernelProvider>
  </StrictMode>,
);
