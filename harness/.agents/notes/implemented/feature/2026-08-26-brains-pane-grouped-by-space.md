# Agent Note: the Brains pane is grouped by space

Status: implemented

Reads the vocabulary from [`@idealize/spaces`](../architecture/2026-08-26-idealize-spaces-vocabulary.md) and closes the gap the [space-then-brain welcome card](2026-08-26-welcome-card-space-then-brain.md) handed on: the space carried into the add sheet is now persisted.

## Problem

The pane's Usage tab listed one flat roster called Activities: the four activity agents, then the three media presets labelled Images / Motion / Sound. Everything else — Free, Lead Agent, Project Coordinator, anything the user added — fell into Agent roles beneath it.

Three things were wrong with that once spaces existed.

The list answered a question the product had stopped asking. "Which activity is this?" was the old vocabulary; the welcome card now asks which space, then which brain, and the pane that configures those brains said nothing about spaces at all.

Free was filed as an agent role. The route marked it `defaultRoster: false` because the free-tokens route pins its model, so it was not a preset→model decision — but it is a brain the user picks when starting a chat, in Chat and in Terminal both, and Lead Agent is not. One flag was carrying two unrelated facts.

And the media rows spoke a third vocabulary. `images` / `motion` / `sound` are the stored ids; Gallery / Sound Stage / Motion are what the user calls those spaces everywhere else in the app.

## Decision

**One section per declared space, in the order `GET /idealize/spaces` serves them, and a brain lists under every space it works in.**

The grouping is driven from one field: `/idealize/activity/agents` now serves each brain's `spaces`, computed by `presetSpaces` (`@idealize/spaces`) over the `spaces` map of the `idealize-activity-pills` settings section. A brain the user has never placed by hand reads as its computed default, so Free arrives in Chat **and** Terminal without a stored entry, the media agents arrive in their own space, and the two agent-role presets arrive in none.

**Agent roles are the brains that work in no space.** That is the same fact the section always meant, stated as data rather than as a second flag: `spaces.length === 0`. `defaultRoster` retires, and the one thing it also encoded — the free-tokens route resolving Free's model — becomes its own field, `modelPinned`, which makes Free's row state the resolved model where every other row offers a picker.

**The media rows are relabelled, never renamed.** `MEDIA_LABEL_KEYS` maps `images` → Gallery, `sound` → Sound Stage, `motion` → Motion, in `en` and `zh`, and each row now renders inside its space's own group as that space's generation-model row. The ids key the user's stored model choices in the settings document, so renaming one would silently discard every choice they have made.

**Motion keeps its unavailable state here, and it stays a runtime answer.** The row renders from the live `/idealize/brains/media` availability verdict, so Motion lights up on its own the day a compatible video model appears — no constant says Motion is unavailable. The structured reason selects one localised recovery sentence throughout the welcome and onboarding flows. Known generation refusals name the OpenRouter action each surface provides. Unknown space-level refusals retain the route fallback. This is the pane's half of the invariant the welcome card states: the space chooser offers, the brain screen explains. The chooser still shows Motion as an ordinary tile with a brain count; the full reason and the add-key recovery live here and on the brain step.

**The add sheet asks the spaces first, then the model those spaces narrow it to, then the instructions**, with the hint the user approved: "Sent with every message this brain handles." Each space group carries its own add row, which opens the sheet with that space already checked.

**Spaces are checkboxes, not a single choice, and they are editable on an edit.** A brain works in more than one space — Free is the shipped example — so a single-select would have collapsed Free's two spaces into one the first time somebody edited its instructions. The checkboxes arrive pre-checked from the row, so a save cannot silently drop a brain out of a group, and a brain added to the wrong space can be moved without hand-editing a settings file.

**Moving a draft between catalogues clears its model.** Ticking Gallery on a draft that had a chat model picked would otherwise leave that value standing in a field now listing generation models, and the save would write a chat provider id where a generation backend id belongs. The field resets instead, so the user re-picks from the list they are actually looking at.

**An absent `spaces` field means "leave the placement alone".** The inline model picker on each row posts to the same route without it, so changing a brain's model never moves it. `[]` is a real value, distinct from absent: it is what an agent role stores.

**A brain confined to one generating space picks that space's generation model.** For Gallery, Sound Stage and Motion the sheet's model list is the capability-compatible candidates the media route serves and the save goes to `POST /idealize/brains/media`; for every other brain it is the chat catalogue and the save goes to the brain's own `models` override. The two vocabularies stay apart — a generation backend id is not a chat provider — which is why the brain's own override stays unset in the first case.

## Alternatives considered

- **Group from the roster route's `brains` arrays instead of a new field on `/agents`.** The roster already applies `presetSpaces`, so the grouping would have been free. But a roster brain carries no `instructions`, so Edit could not open on it, and the pane would then hold two half-descriptions of the same brain from two routes.
- **Keep `defaultRoster` and add `spaces` beside it.** Two fields answering overlapping questions, one of which no screen would read again.
- **Rename the media ids to `gallery` / `soundstage` / `motion` so the pane and the space table agree.** The ids are the keys of a persisted document; the rename reads as "no model chosen" for every user who had chosen one.
- **A single-select space in the sheet.** Simpler to narrow the model list from, and it silently unfiles Free from Terminal the first time anyone edits it.
- **Show the space read-only when editing, editable only when adding.** No data loss, but a brain added to the wrong space could then only be moved by editing the settings file by hand.
- **Write the generation model as the brain's own `models` override.** It would put a backend id where the availability read expects a chat provider, and `/idealize/activity/models` would then report that brain's route as unreachable.
- **A per-space detail line under each heading.** Five lines saying the same thing about five spaces the user has already named; the headings carry the meaning.

## Consequences

`/idealize/activity/agents` grew `spaces` and `modelPinned` and lost `defaultRoster`; the only reader of that field was this pane. `POST /idealize/activity/agent` grew an optional `spaces`, validated at the wire boundary by `parseSpaces` (exported, unit-tested on the absent / empty / normalized / refused branches) and normalized to the declared table order so a stored list always reads back in that order. Both maps are written whole, because the section merge replaces a named key's value rather than merging into it.

`@idealize/activity-pills` now value-imports `@idealize/spaces` on its host side, the direction that package's own comments reserve for it. The dependency was already declared; nothing new was added to the module graph on the client, where the space list arrives over the roster route and the space vocabulary stays a type-only import.

**A brain in more than one generating space picks no generation model.** The sheet narrows on exactly one, which is the only case where "the model this brain uses" has one answer. Such a brain saves with no model and takes each space's own.

**Two brains in one generating space share that space's generation model.** The media route keys models per preset, not per brain, so the second brain's sheet shows what the first one set. The pane has always shown that value on the space's own row; the sheet is a second control over one stored fact, not a new one.

The pane now reads four routes rather than three: `/idealize/spaces` supplies the space order, which is stated in exactly one place — the declared table — and reaches the client without a cross-package value import.

## Proof

`.idealize/proof/brains-spaces-*.png`, `brains-spaces-lower-*.png`, `brains-add-gallery-*.png`, `brains-add-chat-*.png` and `brains-added-soundstage*.png`, from [`packages/idealize/ui-bar/proof/brains-presets-proof.mts`](../../../../packages/idealize/ui-bar/proof/brains-presets-proof.mts): the real assembled `idealize` profile, booted in a scratch `HOME` and `DSH_HOME` the run refuses to start outside, driven at 1280×840 in both themes through the shared settle helper.

Twenty-six assertions, every one read back off the rendered DOM: the five space headings in the declared order with their brains; Free under Chat and under Terminal with its pinned model stated and no picker; Motion's row carrying `no-compatible-model` with the add-key action, beside Gallery and Sound Stage picking models from the same live route, which is what makes the refusal an answer rather than a constant; the agent-role section below the last space group; the add sheet's fields in the order `spaces, name, model, instructions`, opening on Gallery alone with the approved hint; and the two model-list counts — **3 options for Gallery against 7 for Chat**.

Persistence is proven twice over: the host reports the saved brain with `spaces: ['soundstage']`, and after a full page reload that brain is still in the Sound Stage group and in no other.

The run's own composition supplies both catalogues (a four-model mock chat route, a generation backend publishing two stills and one tone and no video) and turns the shipped OpenRouter generation backend off, so the counts are the run's own numbers rather than a vendor catalogue's.
