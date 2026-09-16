# Agent Note: the composer switches the brain, and says what it costs first

Status: implemented

Follows [the welcome card's two steps](2026-08-26-welcome-card-space-then-brain.md), which chooses the space and the brain a chat STARTS on. Reads the vocabulary, the roster and the `brain` projection from [`@idealize/spaces`](../architecture/2026-08-26-idealize-spaces-vocabulary.md).

## Problem

Once a chat had started there was no way to change its brain. The composer's model seat was occupied by an empty component that existed only to hide the shipped model dropdown, and the pill row above the composer offered five fixed activity agents that had nothing to do with the chat's space — a Gallery chat still showed Coding, Design, Writing, Admin and Free.

Worse, the one switch the pill row could make in a Terminal chat cost the running shell, and it said so only after the click, in a dialog. The user learned that the terminal would restart at the moment they had already decided.

The obvious fix — recompose the chat on the new brain — is refused by the host. `agentPresets.select` returns `agent-preset-locked` for a started chat because "a started conversation's history was produced under its preset's tools" (`packages/host/apiproxy/src/api-proxy.ts:3040-3049`).

## Decision

**The space owns the tools; the brain owns the model and the standing instructions.** JJ accepted this on 25 Aug: "Space owns tools, brain is voice + model." So an in-session switch never touches the preset:

| Chat state | What the switch writes |
|---|---|
| Blank | The preset is recomposed, exactly as the welcome card's brain step does: an activity brain through the pill controller (which owns the free-tokens route and the roster default), anything else for this chat alone. |
| Started | `session.selectModel` to the brain's model, then `POST /idealize/spaces/select` records `idealize/brain` with the brain's standing instructions. The tools stay as the history was produced under. |

**The control lives in `@idealize/activity-pills`, on the seat it already occupied.** That package owns `conversation.input.model` (it was shadowing the dropdown with `NoModelSeat`, now deleted), owns `assessPills` and the `terminal-restart` reason, and owns the pill controller the blank-chat path needs. Putting the switcher there left `@idealize/ui-bar` — the file seven slices contend for — untouched, and reached the two things it needs from elsewhere through `ctx.get` probes: `terminalMode.restart` and `idealizeBar.addBrain`.

**What a switch costs is stated in the menu row, before the click.** The Terminal space is the only one running a shell, and two things replace that shell: the brain's provider route differs, or the command a fresh shell types differs. `terminalRestarts` (`src/availability.ts`) is the whole rule; `assessPills` applies its provider half, which is all the host's per-pill read can see because that read answers for the row as a whole and knows no chat's current brain, while the menu applies both halves because it is asking about one named chat.

**The commands come from the host, over a new read route.** `GET /idealize/terminal/launches` serves `{ default, byActivity }` — the same values `@idealize/ui-terminal` resolves the command it types from, so the label and the shell cannot disagree. The route serves the commands, not a verdict, because only the client knows which brain a given chat is running.

**The confirm is a title, one line and two buttons.** "The terminal restarts. You may lose some context." / Cancel / Continue. JJ rejected an earlier keep/lose column layout as "much too wordy". Cancel writes nothing at all — no model, no log record, no shell.

**`terminalMode.restart(sessionId, brainId)`** closes the PTY, drops the cached grid, and lets the mounted view reopen on the new brain's launch command. The close is awaited before the view is told, because the host reattaches an open shell by chat key: reopening any sooner hands back the same process. The chosen brain travels to the reopen through a module-level map, because a started chat's preset is fixed and its session summary therefore still reports the brain the chat began under.

**The menu reads three routes and one projection.** `GET /idealize/spaces` for the brains of this chat's space and the default mark, `GET /idealize/activity/agents` for each brain's resolved model and standing instructions, `GET /idealize/terminal/launches` for the commands. The chat's space and current brain come off the session summary's `space` and `brain` projection values.

**Each row's trailing line, in priority order:** the restart warning where it applies, otherwise "No instructions" for a brain carrying no persona, otherwise the provider it runs on. That is the design's own three-state meta column (Paper `01M0WPEDKBV54502M7YV97PZDZ` page v2, board "3 — Terminal: switching brain").

## Alternatives considered

- **Defeat the preset lock for a started chat.** The lock exists because the transcript the model re-reads each turn was produced under a tool set; changing it mid-chat leaves tool results in the history for tools that no longer exist. The product answer was to split the concern instead, which is what the space/brain division is.
- **Put the switcher in `@idealize/ui-bar` beside the welcome card.** It would share the space labels and reach `addBrain` directly. It would also mean a sixth slice editing `src/client/index.ts` and `locales.ts`, the file the slice plan names as the hot spot, for a control whose seat another package already holds.
- **Have the launches route return a verdict ("does switching to X restart?").** The host would have to know which chat is asking and which brain it currently runs — a per-session read for a fact that is two string comparisons. Serving the commands keeps the route stateless and lets the same payload answer for every chat on screen.
- **Add the launch facts to `assessPills` as a fourth fact.** The host's call site would pass `undefined` forever, because that read has no session. Extracting `terminalRestarts` gives both callers one rule with no dead parameter.
- **Import `launchCommandFor` from `@idealize/ui-terminal` into the switcher.** The client bundle purity gate only polices `@deepseek-ai/` specifiers, so a cross-`@idealize` value import silently inlines a second copy rather than failing the build. The one-line resolution is restated instead, beside a comment naming the owner.
- **Carry the brain's instructions in the space roster payload.** It would save a fetch, but the roster route would have to read every brain's composition file for a field only this menu needs, and `personaOf` lives in `@idealize/activity-pills` — importing it into `@idealize/spaces` would reverse a dependency that package deliberately keeps one-way.

## Consequences

`NoModelSeat` is deleted along with its test; the client slot catalog now records `@idealize/activity-pills BrainSwitcher` on `conversation.input.model`. `@idealize/activity-pills` gains a type-only dependency on `@idealize/spaces` for the space ids and the projection merge.

The switcher renders on a chat with brains to offer. In the Terminal space that means a STARTED chat: while a terminal chat is blank the view owns its whole column and retires the composer from its own stylesheet, so the welcome card's brain step is still the question there. That is the shipped behaviour, not a gap this slice introduces.

**The instructions are logged here and sent by the next slice.** `idealize/brain` carries the brain's standing instructions so the swap is reconstructable from the log, which is what "Model-visible ⟺ logged" requires of anything that reaches a model. This slice records them and nothing more: reading them into the prompt is a model-visible change needing its own snapshot coverage, so it did not belong beside the control. `@idealize/spaces`'s `installBrainPrompt` is that reader — see [the brain instructions note](2026-08-26-brain-instructions-reach-the-model.md), which also records why an absent `instructions` field is unambiguous once the resolved agent preset is read beside it.

The confirm uses the shared `Modal` primitive, which draws a close control in its header. The design board shows none. The control behaves as Cancel, and matching the board exactly would mean a headless dialog with its own header markup for one glyph.

The menu heading takes the `Menu` primitive's own heading style rather than the board's small caps: in portal mode the list renders into `document.body`, so a wrapper class cannot reach it, and the app's shared menu heading is the more consistent answer than a one-off.

Proof: `.idealize/proof/brain-switcher-*.png`, harness [`packages/idealize/activity-pills/proof/brain-switcher-proof.mts`](../../../../packages/idealize/activity-pills/proof/brain-switcher-proof.mts). It boots the whole `idealize` profile at 1280×840 over a scratch home, with the repo's pty-backed `desktopTerminals` stand-in so the shell in the capture is a real zsh, launch commands that differ per brain, and a scripted mock LLM route so a Terminal chat can start. Every assertion is read back off the rendered DOM: a Chat chat's menu with no restart label anywhere; a Terminal chat's menu with "restarts the shell" on exactly the brains whose command differs from the running one, before any click; the dialog's title, its single line and its two buttons; Cancel leaving the grid text and the named brain unchanged and no new command run; and Continue with the new brain's command visibly running in the grid.

The packaged Electron window is the other way to get a real shell, and it cannot render this slice yet: the harness vendored into `~/dev/idealize-desktop` predates `@idealize/spaces`, so that app has no `/idealize/spaces` route for the menu to read its brains from. Refreshing that vendor set is the precondition for a packaged-window capture here.
