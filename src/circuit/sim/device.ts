// circuit/sim/device.ts — SimDevice (mapping of port symbols to implementations).
//
// Ring rule: circuit depends only on contract + kernelee. Compute /
// Infrastructure implementations are never imported directly — always via
// symbol (wiring lives in driver).
// This is a **pure zero-logic catalog**: sagas (pipes) live in randomize.ts / toggleCell.ts /
// stroke.ts / stepOnce.ts / tickLoop.ts; pure buffer transitions that call no
// symbols (Mutator parts) live in running.mutator.ts (play/pause) and
// stroke.mutator.ts (strokeEnd).
// Settings live in an independent family (circuit/settings/ = Circuit.Settings).

import { type SimDevice } from '../../contract/ports';
import { randomize } from './randomize';
import { pause, play } from './running.mutator';
import { stepOnce } from './stepOnce';
import { strokeMove, strokeStart } from './stroke';
import { strokeEnd } from './stroke.mutator';
import { applyToggle } from './toggleCell';

export const simDevice: SimDevice = {
  play,
  pause,
  step: stepOnce,
  randomize,
  toggleCell: applyToggle,
  strokeStart,
  strokeMove,
  strokeEnd,
};
