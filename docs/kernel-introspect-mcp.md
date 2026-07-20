# kernel-introspect MCP

An MCP server that answers questions about `kernelee-lifegame`'s actual wiring
(the call causality of `kernel.dispatch`/`divert`/`buffer.read`/`buffer.mutate`)
without reading the source. It re-reads a pre-scanned static index,
`.claude/introspect/index.json`, on every query — this is not hand-written
documentation; it returns only facts derived from kernelee's runtime
projection (`projectWiringGraph`) and the ts-morph static scan in
`kernelee-mcp-tools`.

## Initial setup

### Prerequisite: build `kernelee-mcp-tools`

`kernelee-mcp-tools` is a sibling-repository dependency
(`file:../kernelee-mcp-tools`); its `dist/` is gitignored and it has no
`prepare`/`postinstall`, so **a manual build is required the first time**:

```sh
(cd ../kernelee-mcp-tools && npm run build)
```

If you forget this, both the MCP server launch and the CLI below fail with
`ERR_MODULE_NOT_FOUND`-style errors (the launcher prints a guidance message
and `exit 1`s; if the message shows this build command, just follow it).

### Generating the index

```sh
npm run introspect   # generates .claude/introspect/index.json (also part of npm run build)
```

The first run writes the directory (`.claude/introspect/`) from scratch, and
it is regenerated automatically every time as part of `npm run build`.

### Registering the MCP server (per client)

The actual server is the same for every client:
`scripts/introspect-mcp-server.mjs` (a standard MCP stdio server). Clients
differ only in where the configuration file lives and its format.

**Claude Code — project scope (`.mcp.json` at the repository root)**

```json
{
  "mcpServers": {
    "kernel-introspect": {
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR:-.}/scripts/introspect-mcp-server.mjs"]
    }
  }
}
```
With that file in place, any session opened in this repository picks it up
automatically. To use it from sessions opened in other projects, add it at
user scope instead:
```sh
claude mcp add kernel-introspect -s user -- node /absolute/path/kernelee-lifegame/scripts/introspect-mcp-server.mjs
```
**Note**: a running session does not pick up new registrations dynamically —
after registering, resume/restart the session (`claude mcp list` can always
show the registration state itself).

**Gemini CLI — project scope (`.gemini/settings.json`)**

```sh
cd kernelee-lifegame
gemini mcp add kernel-introspect node scripts/introspect-mcp-server.mjs -s project \
  --description "kernelee-lifegame architecture index (arch_overview/arch_endpoint/arch_state/arch_walk/arch_refresh)"
```
**Note**: due to Gemini CLI's own folder-trust mechanism, the first time you
must launch `gemini` in that directory and answer the "do you trust this
folder" prompt in the TUI. Until the folder is trusted, `gemini mcp list`
shows "configured but disabled because this folder is untrusted".

**AntiGravity — `.agents/mcp_config.json`**

```json
{
  "mcpServers": {
    "kernel-introspect": {
      "command": "node",
      "args": [
        "/absolute/path/kernelee-lifegame/scripts/introspect-mcp-server.mjs"
      ],
      "description": "kernelee-lifegame architecture index (arch_overview/arch_endpoint/arch_state/arch_walk/arch_refresh)"
    }
  }
}
```
To replicate in another project, copy this shape as-is and swap in the path.

## Tools

### `arch_overview` — no arguments

Start here. Returns the map: a ring×device table (symbol counts), every
endpoint's `key`/`kind`/first note line, and the headings of
states/sharedStages/parts.

```json
{
  "staleness": "fresh",
  "endpoints": [
    {
      "key": "Circuit.Sim.randomize",
      "kind": "endpoint",
      "noteFirstLine": "Generates a random board, pair-emits GridState and StatsState via the fork (board line/stats line), and resets the generation to 0."
    },
    {
      "key": "Circuit.Sim.tickLoop",
      "kind": "divertTarget",
      "noteFirstLine": "The generation loop body. switch → one generation (fork(symbol) fan-out over Compute.Life.partitionRanges/stepIndexRange) → sleep → divert back into this same pipe (self-divert reentry). Also the divert target of play's detached .spawn launcher."
    }
    // ... 7 more entries omitted (9 in total)
  ],
  "ringDeviceTable": [
    { "ring": "Compute", "device": "Life", "symbolCount": 4 },
    { "ring": "Infrastructure", "device": "Settings", "symbolCount": 2 }
  ],
  "states": ["GridState", "SimState", "StatsState"],
  "sharedStages": [],
  "parts": [],
  "unresolvedCount": 4,
  "meta": { "schemaVersion": 1, "generatedAt": "2026-07-07T22:23:46.016Z", "gitHead": "4998b9bb...", "dirty": true },
  "limitations": { "symbolUsage": { "...": "..." }, "declarations": { "...": "KNOWN GAP: per-stage flows not yet recovered" } }
}
```

### `arch_endpoint` — argument: `key` (endpoint key or bound symbol id)

The complete record for one entry: the stage tree (kind/note/divertsTo/fork
branches), drivenBy (who calls it), readsState/writesState, and divertedFrom.

```json
// arch_endpoint({ key: "Circuit.Sim.randomize" })
{
  "staleness": "fresh",
  "key": "Circuit.Sim.randomize",
  "kind": "endpoint",
  "title": "randomize",
  "inputType": "void",
  "note": null,
  "drivenBy": [
    { "mode": "dispatch", "owner": null, "site": "src/app/main.tsx:53" },
    { "mode": "dispatch", "owner": "ControlBar", "site": "src/presentation/ControlBar.tsx:48" }
  ],
  "readsState": [
    { "state": "GridState", "phase": "stage", "attribution": "function", "site": "src/circuit/sim/randomize.ts:19", "via": null }
  ],
  "writesState": [
    { "state": "GridState", "phase": "stage", "attribution": "function", "site": "src/circuit/sim/randomize.ts:38", "via": null },
    { "state": "StatsState", "phase": "stage", "attribution": "function", "site": "src/circuit/sim/randomize.ts:39", "via": null }
  ],
  "divertedFrom": [],
  "stages": [ /* verb → pipe(Compute.Life.randomize) → verb → fork([board line, stats line → Compute.Life.diffStats]) → map → effect */ ]
}
```

Passing a non-existent `key` does not whiff silently — it suggests nearby
keys:

```json
// arch_endpoint({ key: "does-not-exist" })
{
  "staleness": "fresh",
  "error": "no endpoint or symbol found for \"does-not-exist\"",
  "suggestions": ["Compute.Life.hitCell", "Circuit.Sim.stepOnce", "Compute.Life.diffStats"]
}
```

### `arch_walk` — arguments: `from` (endpoint/symbol/state/sharedStage), `edges?`, `depth?` (default 1)

Expands typed edges (`drivenBy`/`divertsTo`/`callsSymbol`/`reads`/`writes`/
`usesSharedStage`) from `from` up to the given depth. `edges` is a
direction-agnostic filter (e.g. from a state, `edges: ["writes"]` lists the
endpoints that write that state).

```json
// arch_walk({ from: "Circuit.Sim.randomize", depth: 1 })
{
  "staleness": "fresh",
  "from": { "kind": "endpoint", "id": "Circuit.Sim.randomize" },
  "depth": 1,
  "edgeFilter": null,
  "edges": [
    { "kind": "drivenBy", "from": { "kind": "endpoint", "id": "Circuit.Sim.randomize" }, "to": { "kind": "driveSite", "id": "ControlBar@src/presentation/ControlBar.tsx:48" }, "detail": { "owner": "ControlBar", "site": "src/presentation/ControlBar.tsx:48", "mode": "dispatch" } },
    { "kind": "writes", "from": { "kind": "endpoint", "id": "Circuit.Sim.randomize" }, "to": { "kind": "state", "id": "GridState" }, "detail": { "site": "src/circuit/sim/randomize.ts:38", "phase": "stage", "attribution": "function", "via": null } },
    { "kind": "callsSymbol", "from": { "kind": "endpoint", "id": "Circuit.Sim.randomize" }, "to": { "kind": "symbol", "id": "Compute.Life.randomize" } }
  ],
  "nodes": [ /* the expanded endpoint/driveSite/state/symbol nodes */ ],
  "truncations": ["depth-limit-reached: stopped expanding beyond depth 1 — 6 node(s) at the frontier were not further expanded"]
}
```

### `arch_state` — argument: `state` (buffer state type name)

Declaration site, writers (endpoint/phase/site), and readers (split into
circuit vs presentation).

```json
// arch_state({ state: "SimState" })
{
  "staleness": "fresh",
  "name": "SimState",
  "declaration": "src/contract/states.ts:56",
  "mutatingMethods": [],
  "writers": [
    { "endpoint": "Circuit.Settings.setSpeed", "phase": "stage", "attribution": "function", "site": "src/circuit/settings/setSpeed.ts:23", "via": null },
    { "endpoint": "Circuit.Settings.setGranularity", "phase": "stage", "attribution": "function", "site": "src/circuit/settings/setGranularity.ts:21", "via": null },
    { "endpoint": "Circuit.Settings.hydrateSettings", "phase": "stage", "attribution": "function", "site": "src/circuit/settings/hydrateSettings.ts:18", "via": null }
  ],
  "readers": {
    "circuit": [
      { "endpoint": "Circuit.Sim.tickLoop", "phase": "stage", "attribution": "function", "site": "src/circuit/sim/tickLoop.ts:58" },
      { "endpoint": "Circuit.Sim.stepOnce", "phase": "stage", "attribution": "function", "site": "src/circuit/sim/stepOnce.ts:29" }
    ],
    "presentation": [
      { "owner": "sim", "site": "src/presentation/ControlBar.tsx:23" }
    ]
  },
  "presentationWriters": []
}
```

### `arch_refresh` — no arguments

Runs `npm run introspect` with `cwd=repoRoot` and reloads the index on
success. On failure the existing `index.json` is left intact (thanks to the
atomic write).

```json
// success
{ "staleness": "fresh", "ok": true, "generatedAt": "2026-07-08T...", "gitHead": "4998b9bb...", "dirty": true }
```

```json
// failure (timeout or non-zero exit) — stderr is tail-truncated
{ "staleness": "unknown", "ok": false, "reason": "timeout" /* or "nonzero-exit" */, "command": "npm run introspect", "stderrTail": "...", "stderrTruncated": false }
```

## `staleness` (returned by every tool)

Determined from a working-tree content hash via `git write-tree`, so a dirty
tree does not degrade to `unknown`:

- `fresh` — the on-disk tree content matches the index generation exactly.
  Trustworthy even mid-edit.
- `stale` — the tree changed after generation (any edit under `src/`
  qualifies). Run `arch_refresh` before relying on it.
- `unknown` — a git query failed, or the index is an old format without
  `workingTreeHash`. Refresh.

## Known limitations

- `stage.flows` (the flow of types inside a pipeline) is not recovered yet —
  `inputType` (the type at the endpoint's entrance) is available, but
  per-stage type propagation is still `null`.
- An endpoint's `note` is filled only where the fourth argument of
  `describePipe` was written by hand. There is no CI completeness check for
  notes (the completeness of the wiring catalog itself is pinned in CI by
  `validateWiringGraph` — a separate axis from note coverage).
- "Which value selects which branch" (e.g. `SimState.granularity` → the
  tickLoop divert target) cannot be followed by static scanning. The type's
  domain (the set of possible values) is visible via `inputType`, but the
  value→branch mapping itself is unreadable unless it is turned into a data
  declaration (for now, free-text `note`s point at where it lives).
