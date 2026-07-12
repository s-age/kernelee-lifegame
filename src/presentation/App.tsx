// presentation/App.tsx — overall layout.
//
// Ring rule: presentation depends only on contract + react-kernelee
// (App.tsx itself imports only sibling components within the same
// presentation ring).

import type { ReactElement } from 'react';
import { ControlBar } from './ControlBar';
import { ErrorBanner } from './ErrorBanner';
import { GridCanvas } from './GridCanvas';
import { StatusBar } from './StatusBar';

export function App(): ReactElement {
  return (
    <main className="app">
      <h1 className="app-title">kernelee-lifegame</h1>
      <ErrorBanner />
      <ControlBar />
      <GridCanvas />
      <StatusBar />
    </main>
  );
}
