# An unchanged write keeps the current reference — the flip side of copy-on-write

## The suppression point is the writer, not the Buffer

`Buffer.mutate` fires its listeners unconditionally (kernelee's spec — it
fires even when the reference is unchanged). Re-renders are still suppressed
because react-kernelee's `useSyncExternalStore` bails on `getSnapshot`'s
**Object.is reference comparison**. So the correct place for the suppression
is not the framework but the **mutate callback returning `current` as-is when
the value is equal**. The copy-on-write convention is "a new reference when
the value changes", not "a new reference on every write" — this flip side is
spelled out in the convention comment in `contract/states.ts`.

## Unchanged writes are routine, not an edge case

- **strokeEnd**: the view stays a pure sensor and sends from **both**
  pointerUp and pointerLeave (a consequence of the discipline that
  interpretation is owned by the circuit). Every time the mouse leaves the
  board, an overwrite to "already inactive" arrives.
- **StatsState**: on a still-life board, alive/births/deaths are identical
  every generation.
- **hydrate**: a startup where the saved values equal the defaults reflects
  identical values.

Once you adopt a "the view sends everything" design, suppressing unchanged
writes becomes standard equipment on the writer side.

## Keep the guard inline, not in a shared helper

The three-field Stats comparison is duplicated in two places (the
generation and randomize mutators), but a shared helper has nowhere to live —
circuit may import only kernelee + contract, and putting it in compute makes
it a floating "pure function that belongs to nobody's vocabulary". For a
three-line comparison, each Mutator carrying its own copy preserves the part's
self-containment.
