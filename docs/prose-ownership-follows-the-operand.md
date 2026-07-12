# Prose ownership follows the operand

## What

**Prose ownership follows the operand.** Closure stages (`pipe/map/effect
(closure)`) actively carry a site `note` — required on `pipe(closure)` (the
CI floor, expressible as the bare kind since `(closure)` structurally
implies no identity), preferred on `map`/`effect` beyond self-evident
projections. Symbol stages carry NO site prose: the symbol's declaration-side
`description` owns "what it does" and is transcribed mechanically. The one
exception is `tap({ note }, sym)` for site-specific context ("why tap
*here*" — e.g. disk-first ordering) that the declaration cannot know.

## Why

The asymmetry is about *checkability*, not taste: a closure's note sits at
the SAME call site as its body, so any diff touching the body shows the note
in the same hunk — "does the note still hold?" is a one-glance review check.
Per-site prose for symbols has no such adjacency and would silently rot,
duplicating a description that already lives (and stays fresh) at the
declaration. Corollary review habit: closure body changed → check its note
in the hunk; symbol description changed → nothing to chase at call sites.

## Gotchas

- Mandatory notes on ALL stages were considered and rejected: note PRESENCE
  on optional kinds is itself a signal ("this needed explaining"), and
  unchecked prose made mandatory rots into a green-looking lie. Checked
  declarations are the type layer's job (flows).
