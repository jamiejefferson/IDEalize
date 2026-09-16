# Agent Note: Spaces are declared and durable; the view ring only renders them

Status: implemented

## Problem

IDEalize had no answer to "which space is this chat". The `conversation.view` ring was doing three jobs at once: rendering the active view, defining which spaces exist, and remembering which one a chat was in. Only the first is a job the ring is good at.

The roster job it cannot do at all. `HeroLauncher` derived its row from ring membership (`packages/idealize/ui-bar/src/client/HeroLauncher.tsx:177-182`), so a space with no view package could never appear — and Motion has no view package, while JJ's rule puts Motion on the chooser as an ordinary, clickable tile.

The memory job it does badly. The active view lives in the per-session chat store's `view` field, persisted to `localStorage` as `dsh.conversation.chat.<sessionId>` (`packages/client/ui-conversation/src/client/stores.ts:26,30`). That is per-machine, wiped with site data, and invisible to the host and to the sidebar — so "the space is fixed for the life of the chat" and the sidebar's icon lane both had nothing to read.

## Decision

The ring survives as the rendering mechanism and stops being the vocabulary. A new `@idealize/spaces` owns two things.

**A declared table of five spaces** — `chat`, `terminal`, `gallery`, `soundstage`, `motion` — each carrying its label key, glyph key, composition source (`standard` for Chat and Terminal, the media composition for the other three), the seeded agent preset where one exists, and the `MEDIA_PRESETS` id whose capability the availability read uses. Declared, not derived: four of the five ids equal the ring entry id that renders them, so the ring seeds from a space with no translation table, and Motion gets a row despite having no view package.

**A durable record**: `idealize/space` and `idealize/brain`, both `SessionEventMap` merges with projections, appended by `POST /idealize/spaces/select` with the envelope's `ignorable` marker. `idealize/brain` carries the brain's standing instructions because those reach the model with every message it handles, and the repo's model-visible ⟺ logged rule requires a session event for that.

**The vocabulary joins the read path in this change.** `pnpm run gen-persistence-catalog` puts both events in `KNOWN_SESSION_EVENT_TYPES` and the persistence catalog before anything appends them. This is the failure the fork has already paid for twice ([agent-name reload](../bug-fix/2026-08-24-agent-name-event-blocks-session-reload.md)): an event that ships without the regeneration makes every log carrying it unreadable, by the same build that wrote it. No `SESSION_FORMAT_VERSION` bump — vocabulary growth is exactly what the per-event marker covers.

**Chats made before spaces existed derive, and nothing is written into their logs.** `deriveSpace` runs three branches: a recorded `idealize/space` wins; else a `gallery` or `soundstage` agent preset names its own space; else Chat. Terminal is deliberately underivable, because the pre-spaces terminal launch wrote nothing durable — only the browser store. The cost is one wrong glyph on old terminal chats; the alternative is a per-machine backfill that would make the sidebar disagree with itself across devices, and rewriting a user's session log has no undo.

**Which spaces a brain works in is a sibling key**, `spaces`, in the existing `idealize-activity-pills` settings section beside `models`. `settings.update` merges rather than replaces (`packages/settings/settings/src/index.ts:534-536`), so a write to either key leaves the other intact. Renaming the section would silently discard every model choice the user has made, so the section keeps its name even though its surfaces change.

## Alternatives considered

- **Keep the ring as the space vocabulary.** It renders exactly one entry per chat, and Gallery's aspect strip, Sound Stage's length picker and the terminal's composer suppression all hang off ring entries. Dissolving it rewrites shipped, working rendering for no user-visible gain — and it still could not carry Motion.
- **Backfill `idealize/space` into existing logs.** It would make every old chat's glyph right in one pass. It also rewrites durable user data with no undo, and the only evidence for a legacy terminal chat is a browser store that differs per machine, so the backfill would be wrong on the second device.
- **Derive the roster from the ring and special-case Motion.** One conditional today, and a second the next time a space ships ahead of its view. A declared table has one home for the answer.
- **A new settings section for `spaces`.** Cleaner to read, but it splits the per-preset decisions across two documents and tempts a future `replace` write that wipes the other. The sibling key survives every save both surfaces already make.
- **Type the stored space lists as the declared id union in the settings schema.** The settings document is a file boundary, so the schema takes plain strings and `presetSpaces` narrows on read — which is also where the per-preset default is computed.

## Consequences

The sidebar lane, the welcome chooser and the composer's brain switcher all read one host-owned fact, so they agree with each other and survive a cleared browser store. A legacy terminal chat shows the Chat glyph; its embedded shell is still one ⌘J away.

The declared roster changes one shipped behaviour: a plain browser (no desktop shell) used to hide the Terminal way to start, because ui-terminal registered no ring entry. The Terminal tile now always shows, and the brain step explains that the terminal runs in the desktop app. That is the invariant this reshape is built on — the chooser offers, the brain screen explains — and it is why no tile is ever dimmed.

`@idealize/spaces` exports no client value module. Its `./client` face is types only, because the client bundle gate does not police `@idealize/*` specifiers (`packages/client/tsdown.client.ts:220-229`): a cross-package value import would silently inline a second copy of the module rather than fail the build.

The `session-format-guard` acceptance suite now pins the read path for the real event: a log carrying `idealize/space` resumes through the assembled Loader composition and the record survives re-persistence verbatim.
