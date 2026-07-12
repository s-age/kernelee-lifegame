# Part identity is (name, kind) — don't appease a nonexistent constraint with naming

## Discovery: a doc comment claimed a constraint stronger than reality

An older mutator part carried a doc comment saying "duplicate part names break
the `parts` name→PartEntry index (the 1 part = 1 name assumption)" — but that
index did not exist anywhere in production:

- `scanPartFiles` just returns an array (name derived from basename, no
  uniqueness check)
- `PartEntry` carries `kind` / `file` alongside the name
- the devtools panel's color-coding join is keyed by **file** (`kindByFile`,
  panel.js)
- the only name-keyed Map was a convenience inside lifegame's own tests

So a disambiguating name suffix was an appeasement of a constraint that did
not exist. **Before working around a claimed constraint with naming, locate
the site that actually enforces it** — a doc comment's claim is the
understanding at the time of writing, not necessarily a machine fact.

## Convention: (name, kind) is the identifier

The Swift original's `<Owner>+Emitter.swift` convention puts the kind in the
file name, and sharing the owner part is naturally expected. The TS dot-suffix
(`.emitter.ts` / `.mutator.ts`) is its counterpart, so identity is
(name, kind). `generation.emitter.ts` and `generation.mutator.ts` sharing the
name `generation` is not a collision. Tests look parts up by a name.kind key
and pin uniqueness itself with `byId.size === parts.length`.

The mutator naming convention, made explicit at the same time: name it after
the owning pipeline/saga; when one file serves multiple owners, name it after
the target state it writes (e.g. `simState`).

## Design decision: keep the family flat — the arbitration criterion is LLM analyzability

A feature-directory proposal (`${feature}/`, kind separation under `parts/`)
was rejected. The owner's declaration: **what is best for an LLM is what this
architecture should be; humans can read it through the wiring.**

- Ownership is a DAG, not a tree (`generation.*` is shared by
  tickLoop/stepOnce; `cellVisit.switch` spans stroke→togglePipe via divert).
  Putting shared nodes into a feature directory makes the tree's claim of
  "exclusive ownership" contradict the "shared" reality of usedBy, injecting a
  false ownership prior into an LLM.
- Flat means one `ls` is a complete bill of materials, and a single path
  carries three facts: family, owner, and role. Kind separation splits the
  question that is always asked ("everything in this feature") to optimize a
  question nobody asks ("all emitters") — glob and the index already answer
  the latter.
- The escape hatch at scale is splitting family and port together, not
  subdirectories.
