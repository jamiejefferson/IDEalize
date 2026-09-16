# Agent Note: Wave C4 — steady sliders and a font picker you can type into

Status: implemented

The Appearance slice of JJ's 28 Aug review (plan: `.idealize/plans/feedback-wave-c-plan.md`): "the sliders behave erratically" and "the font picker gains type-to-find". Both changes are in `@idealize/appearance`.

## Problem

Every slider in the panel wrote its setting on every pointer move through `write()`, which mirrored the value optimistically and then called `scope.set`. The scope subscription (`adoptSettings`) repainted the panel on every acceptance. A drag therefore queued dozens of writes, and each acceptance landing mid-drag re-projected an older document: the thumb and the readout jumped backwards and forwards until the last write settled. The interface-size slider had a second fault of its own: its value is the root zoom, so a per-move commit rescaled the panel under the pointer and moved the slider away from the thumb.

The font picker listed every installed family (hundreds on JJ's machine) in a scrolling listbox with no way to narrow it.

## Decision

**The accepted document is adopted only when no write is in flight.** `write()` counts in-flight `scope.set` calls; `adoptSettings` returns early while the count is above zero, and the last write's settlement adopts once. The optimistic mirror is what the panel shows during the drag. A write settling after the plugin is disposed adopts nothing (the teardown effect flips a `live` flag), so the projection stays torn down.

**The interface size commits on release.** `SliderRow` takes `commit: 'live' | 'release'`. A `release` slider shows the dragged value from local state, with the readout following, and calls `onChange` once on pointer-up, key-up or blur. Every other slider stays `live`: controlled by the mirrored value, committing per move, which the in-flight guard now keeps steady. `display` became a function of the value so a release slider's readout can follow the drag.

**The font listbox opens with a type-to-find field.** The field takes focus when the list opens, filters families by case-insensitive substring, keeps the empty pick (System or Default) listed throughout, and Enter picks the first match. Closing resets the query. One field serves all three pickers (interface, surface, terminal).

## Alternatives considered

- **Debounce the writes.** Fewer writes, but the acceptances that do land would still repaint older values between them; the fault is adopting mid-drag, not the write count.
- **Commit every slider on release.** Live preview is the point of the colour, opacity and spacing sliders; only the zoom slider fights the pointer.
- **A native `<select>` for fonts.** Rejected when the picker was built: the popup cannot be styled on macOS, and each family renders in its own face.

## Consequences

`panel.client.spec.tsx` pins the release commit (a change with no release calls nothing, the readout follows, one commit on pointer-up), and the find field (focus on open, narrowing, Enter picks the first match, a reopen lists everything). `apply.client.spec.ts` continues to pin teardown; the settled write after dispose is what the `live` flag guards.
