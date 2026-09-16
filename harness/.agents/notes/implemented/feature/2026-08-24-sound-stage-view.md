# Agent Note: The Sound Stage is a list of sounds with a player

Status: implemented

## Problem

Slice S6 of the multi-activity plan asks for the Sound Stage mode. The plan's own sentence for it was "same shape [as the Gallery]; rows with an `<audio>` element over the raw route", which leaves the interaction undecided. JJ settled it: the Sound Stage is a SoundCloud-style list of sounds with a player, a list view rather than a grid, joining the view choice alongside Chat and Terminal.

Three facts about the merged S1–S4 code shaped the build. `@idealize/artefacts` serves bytes by id (`GET /idealize/artefacts/raw?id=`) but publishes no listing, so a view over a project's artefacts has nowhere to read the set from. `@idealize/gen-tools` runs generations through `generate_audio`, whose failures surface both as a failed tool result (carrying the prompt) and as `artefact/failed` (carrying only the reserved id). And `dsh-jobs` publishes no session events at all, so "job session events" — which the slice brief names as a status source — do not exist to read.

## Decision

**One package, two halves, on the `@idealize/ui-terminal` template.** `@idealize/ui-soundstage` registers a `conversation.view` entry `soundstage` at order 7 (after the Gallery's 6) and a `conversation.input.dock` entry for the generation setting; the host half registers one read-only route. The bundle patch inserts the row after the terminal toggle.

**The listing route lives in this package, not in `@idealize/artefacts`.** `GET /idealize/soundstage/sounds?cwd=` projects `ctx.artefacts.list({ mediaType: 'audio', workspaceId })` onto a row the browser renders, capped by a `limit` config field. The right long-term home is one media-type-parameterised listing on the artefact engine, and `@idealize/ui-gallery` — built concurrently in another copy — needs the same projection for `image/*`. Putting it there now would have collided with that agent inside a shared file, so the seam is duplicated deliberately and recorded in the package README's Known Limitations for the collapse once both views have landed.

**A GET never registers a workspace.** `resolveByPath` alone, with an unregistered directory answering an empty list; `gen-tools` creates workspaces because a generation must own its bytes, but a read must not.

**Rows come from three sources, in one pure projection.** `buildRows` takes the listing plus the conversation snapshot's facts and returns generations in flight, then failures, then stored sounds, newest first inside each group. `selectSoundFacts` reads `runningCalls` for `generate_audio` (in flight), `nodes` for its failed tool results (cause plus the prompt Retry re-sends), and the `artefact` chat nodes for both the created count and the `artefact/failed` payloads. A background generation settles its call before the work runs, so only the event route reports its failure; those rows carry the cause with no Retry, and a cause a failed call already reported is not repeated.

**The created count is the re-read trigger.** The entry re-fetches the listing when that count moves, so a generation finishing while the stage is open lands in the list without a refresh, and the header keeps an explicit Refresh for everything else.

**The generation setting is a length picker that writes into the draft.** The dock seat reads the ring's active view through the chat entry's shared store (the Chat⇄Terminal shortcut's pattern) and renders nothing in any other view. Choosing a length rewrites one trailing English sentence — `Length: 15 seconds.` — in the composer draft, which the Sound Stage agent passes to `generate_audio`. There is no seam to intercept submission and no client-plugin config channel, so hidden state would have had to be re-stated to the model somewhere invisible; the draft keeps the setting where the user can see, edit, and delete it.

**The shared control sheet is restated, not imported.** A CSS module cannot be composed across a plugin bundle boundary, so `controls.module.css` carries the rail panes' capsule/field/focus-ring treatment on the same `--dsw-alias-*` tokens. Every colour, background, and geometry a composing class needs is a modifier in that file rather than an override at the call site: CSS Modules leaves cross-file `composes` order undefined, and the bundler rejects a property defined on both sides.

## Alternatives considered

**Deriving failures from `artefact/failed` alone.** Rejected: that payload has no prompt, so Retry would have had nothing to re-send.

**A grid of cards with a custom transport bar.** Rejected against JJ's instruction, and the native `<audio>` element brings play, seek, volume, and keyboard access for free. The stage sets `color-scheme` from the app theme so the browser paints those controls to match, rather than to the OS setting.

**Persisting the length in a settings section.** Rejected: a stored number that only reaches the model by being re-stated in a prompt is hidden state with a second source of truth.

## Consequences

A background (`run_in_background: true`) generation shows nothing between its call settling and its `artefact/created`, because no job vocabulary exists to read; the README records it. The listing has no pagination beyond `limit`. The proof run captures ten screenshots at 1280×840 (five scenes × two themes) against a real booted composition: `@idealize/gen-fixture` supplies the generated sounds keylessly, and a one-second tone is committed alongside them because the fixture's audio payload is a 44-byte silent WAV whose duration decodes to zero — the playback proof asserts `readyState` 4, a one-second duration, a `currentSrc` on the artefact raw route, and an advancing `currentTime`.
