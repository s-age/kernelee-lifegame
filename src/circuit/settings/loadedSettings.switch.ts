// circuit/settings/loadedSettings.switch.ts — Switch part.
//
// A Switch "only translates the device's decision into a verb (next/abort)" —
// this decision is "did the store yield settings?" (the return value of
// Infrastructure.Settings.load; missing and corrupt data are all collapsed to
// null — the decision data arrives riding the cursor, fetched plainly by the
// immediately preceding stage rather than across a fork). It holds no writes:
// a pure selects-only Switch (no exception needed).
//
// Per the topology classification (branching = *.switch.ts) the gate is a named
// function in its own file; the note string lives at the call site
// (`.pipe({ note: ... }, loadedSettingsGate)` in hydrateSettings.ts).

import { abort, next, type Kernel } from '@s-age/kernelee';
import type { SimSettings } from '../../contract/ports';

/** Missing or corrupt data keeps the defaults (abort — settings never block startup). */
export function loadedSettingsGate(_kernel: Kernel, loaded: SimSettings | null) {
  return loaded ? next(loaded) : abort(undefined);
}
