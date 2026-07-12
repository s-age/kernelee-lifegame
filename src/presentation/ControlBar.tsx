// presentation/ControlBar.tsx — Play/Pause/Step/Randomize + speed slider.
//
// Ring rule: presentation depends only on contract + react-kernelee
// (never imports kernelee itself, circuit, compute, or driver).
// The view has only the two verbs useBuffer (read) / useDispatch (send) — it
// never calls kernel.call or buffer.mutate directly.

import { type ChangeEvent, type ReactElement } from 'react';
import { useBuffer, useDispatch } from '@s-age/react-kernelee';
import { SettingsActions, SimActions } from '../contract/ports';
import { CHUNK_COUNT, GridState, LoopState, SimState, type ForkGranularity } from '../contract/states';

const SPEED_MIN = 1;
const SPEED_MAX = 60;

/**
 * While phase === 'running', Play/Step are disabled; otherwise (idle/stopping)
 * Pause is disabled. This is decoration (rendering of state), not a
 * load-bearing guard — double starts are guarded by LoopState itself
 * (tickLoop's launch gate), and stepping while running/stopping by
 * stepOncePipe's entry gate (abort). Nothing breaks if disabled is removed.
 */
export function ControlBar(): ReactElement {
  const loop = useBuffer(LoopState);
  const sim = useBuffer(SimState);
  const grid = useBuffer(GridState);
  const dispatch = useDispatch();
  const isRunning = loop.phase === 'running';

  const handleSpeedChange = (event: ChangeEvent<HTMLInputElement>): void => {
    dispatch(SettingsActions.setSpeed(Number(event.target.value)));
  };

  const handleGranularityChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    // The <option> values can only be the 3 choices below (circuit also guards unknown values).
    dispatch(SettingsActions.setGranularity(event.target.value as ForkGranularity));
  };


  return (
    <div className="control-bar">
      <button type="button" onClick={() => dispatch(SimActions.play())} disabled={isRunning}>
        ▶ Play
      </button>
      <button type="button" onClick={() => dispatch(SimActions.pause())} disabled={!isRunning}>
        ⏸ Pause
      </button>
      <button type="button" onClick={() => dispatch(SimActions.step())} disabled={isRunning}>
        ⏭ Step
      </button>
      <button type="button" onClick={() => dispatch(SimActions.randomize())}>
        🎲 Randomize
      </button>
      <label className="speed-control">
        <span>Speed: {sim.genPerSec.toFixed(0)} gen/s</span>
        {/* SimState.genPerSec is already clamped by circuit (setSpeed) — the view
            does not re-clamp (out-of-range display is rounded by <input type=range> itself). */}
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={1}
          value={sim.genPerSec}
          onChange={handleSpeedChange}
          aria-label="speed"
        />
      </label>
      <label className="granularity-control">
        <span>Fork:</span>
        {/* Switchable while running too — the tick loop picks its divert target every lap, so it takes effect from the next generation. */}
        <select value={sim.granularity} onChange={handleGranularityChange} aria-label="granularity">
          <option value="chunk">Chunk ({CHUNK_COUNT} branches)</option>
          <option value="row">Row ({grid.height} branches)</option>
          <option value="cell">Cell ({grid.width * grid.height} branches)</option>
        </select>
      </label>
    </div>
  );
}
