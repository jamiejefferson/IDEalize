# Agent Note: IDEalize Gallery — a view-target row per generation task, and settings that reach the model through the message

Status: implemented

## Problem

Slices S1–S4 gave IDEalize a generation path: the three `generate_*` tools route through `ctx.generation`, commit bytes through `ctx.artefacts`, and log `artefact/created` / `artefact/failed`. Nothing showed the results as a body of work. The transcript renders one artefact node per event inline among the chat bubbles, which answers "what did that turn produce" and not "what has this project made". S5 owes the spec a Gallery mode (AC-07, AC-09) that presents the artefacts as a grid, shows a generation in progress, and shows a failure with the provider's own cause plus a Retry that resubmits it (MOD-05).

Two facts shaped the design. First, the artefact chat node's payload deliberately carries only what a transcript card needs (`status`, `id`, `mediaType`, `bytes`, `relPath`, `error`) — no call id and no prompt — so a grid built on `snapshot.chat.nodes` could not group artefacts by task, could not caption them, and could not rebuild a retry. Second, the spec asks for generation settings (aspect, count) in the composer's own seats, and `ui-conversation`'s input machine routes every send through a private `default-sink` with no plugin seam before it.

## Decision

**`@idealize/ui-gallery` is browser-only** and adds no session event. It registers its own conversation Definition (`gallery-generation`) and its own view target (`gallery`), folding four records the host already writes into one row per generation task:

| Event | Effect |
|---|---|
| `tool/call` naming `generate_image` / `generate_video` / `generate_audio` | starts the row; the raw arguments JSON supplies the prompt, `aspect`, and `duration_s` |
| `artefact/created` whose `sourceTask.callId` names that call | appends the artefact and settles the row done |
| `artefact/failed` for that call | settles the row failed with the adapter's provider cause |
| a **failing** `tool/result` for that call | settles a row whose call never reached a provider |

The fourth row exists because `gen-tools` throws before any adapter runs when a media preset has no compatible model (the BRN-09 unavailable state), so that failure produces no `artefact/failed` to carry a cause. Only failing results match: matching every result would open a Context for every tool call in every session, and a successful generation says nothing an artefact event has not already said. The first cause recorded wins, so the generic tool text never overwrites the provider's own words.

**The composer controls write a settings tag into the draft.** Choosing an aspect or a count maintains exactly one trailing `[aspect 16:9, 3 images]` on the message; both controls at their default write no tag at all, and the tag stays ordinary text the user can edit or delete. The controls sit in `conversation.input.dock` and share the chat view entry's store (the `@idealize/ui-terminal` ModeShortcut pattern), so they appear only while this chat's ring is on the Gallery tab rather than following every chat in the app.

**Retry resubmits the row's own settings, not the strip's**, through `session.prompt([{ type: 'text', … }], 'queue')` — a new user message, logged like any other, phrased in plain words that name no model or provider (AC-03/AC-14).

## Alternatives considered

**Read the grid from `snapshot.chat.nodes`.** Free, and wrong: the artefact chat payload carries no call id or prompt, so tiles would have no caption, artefacts from one multi-output task would scatter, and Retry would have nothing to resubmit. Widening that payload would make `@idealize/artefacts` serve one consumer's presentation needs, which the capability-seam rule forbids.

**A `GET /idealize/artefacts/list` route.** It would show every artefact in the project rather than this chat's, and would need a host half, a fence, and a second source of truth beside the log. The Gallery is a face of one conversation; the log is already the authority and already replays.

**Intercept the composer submission to attach the settings.** The correct mechanism, and no seam exists: `SessionInputShell`'s `default-sink` is package-private and `FORK.md` keeps IDEalize out of `ui-conversation`'s input machine. Opening that seam is a real upstream change and belongs in its own decision, not smuggled in behind a media mode. The draft tag is the honest interim: the user sees exactly what will be sent, and the tag is deletable.

**Store the settings in a session-scoped client store instead of the draft.** Invisible state that silently changes what the model receives, and — because nothing logs it — it would break the model-visible ⟺ logged rule the moment it affected a request.

**Match every `tool/result`.** Simpler match code, at the cost of one orphan Context per tool call in every coding session for the sake of a case the artefact events already cover.

## Consequences

The Gallery is a pure reader: composing it out costs nothing, and composing it in adds no durable format and no read-vocabulary entry. A generation whose `tool/call` has fallen out of the loaded window renders no row, which is the same paging behaviour the transcript has. The view target adds the second member of `ConversationViewSnapshotMap`, which broke a `ui-trajectory` test stub whose generic `views.get` only typed while the map had one member — fixed in that spec and logged in FORK.md.

Both seat registrations pass literal `name` and `id`: `scripts/gen-client-catalog.ts` reads occupancy off the call site, so a seat filled through a helper or with a const id is missing from the client slot surface the model reads.

Coverage: 36 package tests, including the real tsdown artifact mounted on a live `SlotRegistry` (the ring entry, the Definition, the view target, and the settings row on the chat entry's store register and dispose together) and the four grid states in jsdom. Rendered proofs at 1280×840 in both themes come from `proof/gallery-proof.mts`, which boots the real composition and dispatches the real `generate_image` tool through the real tool registry — genuine records, genuine session log, genuine raw-route bytes — rather than hand-written events.

The settings tag should move behind a real pre-submit contribution seam if one lands upstream; the README records that as the package's first known limitation.
