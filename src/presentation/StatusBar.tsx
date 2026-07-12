// presentation/StatusBar.tsx — display of generation / transition stats (StatsState).
//
// Ring rule: presentation depends only on contract + react-kernelee.
// alive/births/deaths are not scanned in the view; it only subscribes to the
// StatsState the pipeline emitted (demo policy: emit whatever the pipeline can
// emit — births/deaths are transition quantities computable only from the
// before/after pair, so the view could not derive them anyway).

import { type ReactElement } from 'react';
import { useBuffer } from '@s-age/react-kernelee';
import { GridState, StatsState } from '../contract/states';

export function StatusBar(): ReactElement {
  const grid = useBuffer(GridState);
  const stats = useBuffer(StatsState);

  return (
    <div className="status-bar">
      <span>Generation: {grid.generation}</span>
      <span>Alive: {stats.alive}</span>
      <span>Births: +{stats.births}</span>
      <span>Deaths: -{stats.deaths}</span>
    </div>
  );
}
