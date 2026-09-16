# Agent Note: the welcome card asks which space, then which brain

Status: implemented

Supersedes the row decision in [the four-ways-to-start note](2026-08-25-welcome-card-four-ways-to-start.md); that note's `data-blank-view` rule, its composer-seat rule and its restated view switch all remain current. Reads the vocabulary and the roster from [`@idealize/spaces`](../architecture/2026-08-26-idealize-spaces-vocabulary.md).

## Problem

The welcome card asked one question and answered it with two controls that disagreed about what they were choosing. A segment row said Chat / Terminal / Gallery / Sound Stage, and a pill row said Coding / Design / Writing / Admin / Free; the pill click was the launch, so "which space" and "which brain" were one press with no order between them.

Both rows also hid things. The segment row was built from `conversation.view` ring membership (`HeroLauncher.tsx:177-182`), so Motion — which ships no view package — could never appear, and a plain browser lost the Terminal segment entirely. JJ's rule, stated on the v2 design in his own words, is the opposite: "yeah i want you to be able to click it and then select a model on the next screen. so no2 but its only a dead end once."

## Decision

**Two sequential steps, and the invariant that splits them: the space chooser offers, the brain screen explains.**

**Step 1 is five tiles from the declared roster** (`GET /idealize/spaces`), in the table's order: Chat, Terminal, Gallery, Sound Stage, Motion. A tile reads its `id` and its `brainCount` and nothing else — "5 brains" or "No brains yet" — and pressing one advances to step 2 rather than launching. **No tile is ever dimmed, disabled or dropped.** The payload enforces it: `reason` and `recovery` are fields the tile never receives, and there is deliberately no disabled, opacity or pointer-events rule anywhere in the tile block of the stylesheet.

**Step 2 is the space's brains, in three states driven by the roster entry alone.** Brains listed → each row is a button that starts the chat, so the design's earlier "Start in Gallery" action is gone (JJ: "these could be buttons too - click and progress"). No brains but a model can serve the space → "Add a brain for &lt;Space&gt;" as the primary action. No model can serve it → the route's own recovery sentence, the provider-key action, and the way back.

**A space nothing can serve offers no brain rows, however many work there.** Terminal in a plain browser counts five brains and lists none: a row there would start a chat in a space that cannot answer, which is the dead end the second step exists to explain rather than reproduce.

**The refusal sentence comes from the route, never from this component.** `recovery` is what `@idealize/generate` already tells the Brains pane, passed through unchanged, so the welcome card and the pane cannot state the same condition two different ways. The provider-key action appears only for `no-model` and `no-compatible-model`; `desktop-only` gets the sentence and the way back, because no key supplies a shell.

**Launching is three ordered writes.** Select the brain — through the pills controller for an activity brain, so the free-tokens route and the roster default keep working, and through `api.agentPresets.select` for every other brain, so a Gallery agent never becomes what new chats open on. Then record the space and brain durably through `POST /idealize/spaces/select`, before the ring, so a reload between the two finds the chat in the space it was launched into. Then flip the ring through the existing `openChatView` / `terminalMode.open`.

**Both the chosen space and the launch are keyed to the session.** The app reuses one blank chat per project, so a loose boolean would let a re-render snap a launched card back to the chooser, and a loose space would open the next blank chat on the last one's answer.

**`IdealizeBarService.addBrain(space)`** is the seam for state 2. The welcome card and the Brains pane are the same package, so the request travels through the bar's own view store: the pane picks it up, opens its add sheet with the space stated, and clears the request so reopening the pane does not replay it. `addKey` uses the same channel for the provider editor.

## Alternatives considered

- **Keep the tiles derived from the ring and special-case Motion.** One conditional now and another the next time a space ships ahead of its view; and it could not answer "how many brains work here", which is the tile's only number.
- **Dim a tile whose space cannot be entered.** This is the thing JJ ruled out by name. A dimmed tile states a refusal in the one place with no room to explain it and no way to act on it.
- **A second route for the brain list.** The roster route already gathers the presets, the space map and the model overrides, so the brains ride on its entry. One fetch serves both steps, which is why they can never disagree about what is there.
- **Route every brain through the pills controller.** It writes the agent-preset roster default, so starting one Gallery chat would make Gallery the agent every new chat opened on.
- **Write the space record after the ring flip.** Cheaper to read, and wrong on a reload landing between the two.
- **Import `presetSpaces` into the browser to filter `/idealize/activity/agents` client-side.** The client bundle gate does not police `@idealize/*` specifiers, so a cross-package value import silently inlines a second copy rather than failing the build.

## Consequences

`LauncherMedia`, the `available`-from-ring derivation and the pill row are deleted from the welcome card; `@idealize/activity-pills` keeps its service; its in-session strip is gone too ([the pill row retires](../simplification/2026-08-27-retire-the-pill-row.md)). `NoPresetChip` still shadows `conversation.hero.agentPreset`, because the brain step is now the preset choice.

`@idealize/spaces` gained the fix this slice's own number demanded. The captured roster reported six brains for Chat and Terminal against a design of five; the sixth was `standard`, the shipped composition every seeded brain derives from. `brainPresets` now counts `user`-trust presets only — the ones the app seeded or a person authored, and the same set `/idealize/activity/agents` already lists in the Brains pane. The shipped `system` root, `standard` and the other read-only presets beside it, is not brains. Both roster fixtures were re-recorded over a composition with the installed app's two preset roots rather than one.

**A gap this slice hands to S5:** the space carried into the Brains pane's add sheet is stated but not yet persisted. A brain added there takes `presetSpaces`' computed default (Chat and Terminal) until S5 gives `/idealize/activity/agents` its `spaces` field; the marker sits on `Draft.space` in `BrainsPanel.tsx`.

**A pre-existing behaviour this slice makes visible:** the ring's `view` still lives in `localStorage`, so a reload of a blank chat that already launched once comes back with the chooser over the previous space's view. S8 seeds the ring from the space projection and closes it.

Proof: `.idealize/proof/welcome-spaces-*.png`, harness [`packages/idealize/ui-bar/proof/welcome-spaces-proof.mts`](../../../../packages/idealize/ui-bar/proof/welcome-spaces-proof.mts), driving a booted app at 1280×840 in both themes. Every assertion is read back off the rendered DOM: per tile its tag, `disabled`, `aria-disabled`, computed opacity, computed pointer-events and count line; Gallery's brain list and a row click landing on the Gallery ring entry with the Gallery agent and a live composer; Motion's `no-compatible-model` sentence with the key action and a back press that returns to five live tiles; Terminal's `desktop-only` sentence with no key action; and Sound Stage with its brain moved out through the settings map, offering "Add a brain for Sound Stage" and opening the Brains pane with `data-brains-add-space="soundstage"`.
