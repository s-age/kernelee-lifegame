# Changelog

Internal changelog for this app (private, not published to npm).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [0.3.0] - 2026-07-20

### Added
- Adopted `fork(symbol)` dynamic fan-out for the generation loop (`Compute.Life.partitionRanges` / `stepIndexRange`); `tickLoop`/`stepOnce` collapse to fixed decisionless Bridge hops (card FEA89296).
- Composed the generation sequence via port symbol (`Circuit.Sim.advanceGeneration`); retired `appendGeneration` and `stepOnce` (card F72F6310).
- Composed the stroke pipes via Bridge divert (`strokeMove.bridge.ts`); retired `appendStrokeVisit` (card F72D450E).
- Added `Circuit.Faults.clearError` + dismissible `ErrorBanner`.

### Changed
- Every abort now carries a `desc`, adopting kernelee's `abort(value, desc?)` (schema v14 bump).
- `@s-age/*` dependencies now point at npm-registry versions (`^0.5.0` kernelee, `^0.5.0` devtools-bridge, `^0.3.0` react-kernelee, `^0.5.0` kernelee-mcp-tools dev), no longer file:-linked.

### Docs
- Updated README + kernel-introspect-mcp docs for `fork(symbol)`.
