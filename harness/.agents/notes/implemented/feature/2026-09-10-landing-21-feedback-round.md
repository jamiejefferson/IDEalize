# Agent Note: the landing-21 feedback round — one place per choice, and one key per list

Status: implemented

JJ, 10 Sep 2026, walking landing 21, left eleven notes plus one raised mid-round. Six are answered here; the remaining ones (the composer-seat blur, terminal working state and the group-chat post when a terminal run ends) shipped in the two commits before this.

## Problem

Six surfaces each asked their question in the wrong place, or failed to answer one at all.

The Brains pane asked which CLI a Terminal brain launches on the brain's row, while the model that same brain runs was chosen in the edit sheet — two halves of one decision, two places. The sheet's model select then listed every model a service publishes as one flat run with provider names as bare `optgroup` labels, which macOS renders faintly enough that the groups read as one list.

Editing a brain's model changed nothing the person could see: the composer's model seat reads the session's own selection, which the chat took when the brain was chosen and never re-read.

The rail could only be walked with the mouse. The keybind that focuses the composer resolved it through one CSS-module class name, so a restyled column silently broke it.

A document opened between the tool rail and the drawer, so opening one moved the rail across the screen. Its text had one fixed margin, and its outline column highlighted nothing, so a long document gave no answer to "where am I".

The Service hatch named itself inside its Service tab, so the Composition tab was untitled.

## Decision

**One decision, one place.** The Terminal rows state the CLI as text beside the model (`Codex CLI · gpt-5.5`) and the edit sheet chooses it, next to the model field, saving through the same `POST /idealize/terminal/launch` the row used to. A brain being created has no id until the agent route answers, so both id-keyed writes are made against the row that comes back. The sheet asks the CLI **and** the model rather than filtering one by the other: a CLI brings its own models, and this app cannot enumerate them, so a hint says so instead of a picker pretending otherwise.

**The picker's groups carry rules, and the filter arrives sooner.** Each `optgroup` label reads `──  Provider  ──`, and the filter field appears once the catalogue passes twelve models rather than forty — a native select scrolls its own popup, so a list a screen deep costs more to read than to type into.

**The pane hands the saved brain back, and the plugin decides what follows.** `BrainsPanelHost.followBrain(brainId)` is called after every successful save. The plugin checks whether the open chat's recorded brain is that one and, if so, writes the brain's model through `ctx.modelDirectories` — the per-session store the composer's model seat renders. A write around that service reaches the host but never the label. A chat on another brain, or pinned by hand to a model, is untouched, because its recorded brain no longer names the edited one.

**The rail registers what walking it does.** `@idealize/askbar` seats the rail, so it registers `idealize.agentNext` / `idealize.agentPrevious` on `ctx.keybinds` (probed, never injected: without the tour plugin the rail simply carries no shortcut). Each row lists two chords. ⌥⌘↑ / ⌥⌘↓ work while the composer has focus; ⇧↑ / ⇧↓ do the same anywhere else, because inside a textarea those two extend a selection. That second half needed the dispatcher's gate widened: `isAppChord(event, editing)` now takes ⌘ and ⌃ chords anywhere and every other chord only while nothing editable has focus.

**The document pane opens on the conversation's side of the rail.** `shell.deck` moves from grid column 6 to column 5, so the tool rail keeps the same screen position whether a document is open or not. The drawer's drag handle therefore always offsets past the rail, which now always stands between the drawer and whatever is inside it.

**The document surface takes a margin, and its outline says where you are.** `docMargin` joins the appearance settings beside `chatMargin` (`ChatPanelSettings` becomes `PanelScalars`, `chatPanelCss` becomes `panelScalarsCss`, and the panel face's `setChat` becomes `setScalars`), feeding `--idealize-doc-pad` on the `doc` surface; the file viewer's markdown, editor and code bodies read it. `activeHeading(offsets)` names the section the reader is in — the last heading whose top has passed the scroller's edge, and the first one before any has — measured from live rects on every scroll, because the deck resizes and the markdown reflows under it.

**The hatch names itself in its pane header.** The title moved out of the Service tab's opening bubble, so it stands over both tabs.

## Alternatives considered

**Listening for `idealize:brains-changed` in `@idealize/activity-pills` instead of a host call.** The switcher controller there knows the chat's brain, but only after its menu has been opened once; before that it holds no session at all. The pane already knows exactly which brain was saved, and the plugin already knows which chat is open, so handing the id across is the shorter path with no timing question in it.

**⇧↑ / ⇧↓ alone, as JJ wrote them.** Inside the composer those extend the selection, and taking them would break ordinary editing at the one moment a person is most likely to want them. The ⌥⌘ pair covers that case; the plain pair covers every other.

**Filtering the sheet's model list by the chosen CLI.** No per-CLI model catalogue exists, and inventing one would go stale the day a CLI ships a model. The hint states the relationship instead.

## Consequences

`@deepseek-ai/dsh-client-ui-model-selection`'s `modelDirectories` is now read by `@idealize/ui-bar` through a restated face and `ctx.get`, so a composition without the model seat falls back to `api.sessions.selectModel` and the label follows on the seat's next load.

`scripts/gen-doc-graphs.ts` exempted events declared under `packages/client/` from the "every event needs a dispatcher" gate, on the grounds that the relation scan seeds the host aggregate alone. `@idealize/ui-terminal` registers in the Client aggregate while living under `packages/idealize/`, so the exemption now reads the aggregate's own reference list rather than a directory prefix.

`seatBlurRule` scopes its `::before` to `[data-phase='active']`, compounded onto the chat surface root that carries the attribute. The seat is `position: sticky` in that phase alone; in every other phase it is static, so `inset: 0` resolved against the viewport and frosted the whole window (JJ, 11 Sep 2026: "why is everything blurred!?"). The active phase is also the only one holding a transcript to mask.
