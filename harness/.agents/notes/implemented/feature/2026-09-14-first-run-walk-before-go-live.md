# Agent Note: the first run walked on the packaged app before go-live

Status: implemented

JJ, 14 Sep 2026: "i think we're close to ready for go-live. please walk the initial set-up and onboarding experience to ensure everything is covered - especially the new features. Also please make sure that all documentation is up to date and ready for us to archive v0."

## Problem

The packaged build, launched on an empty home over the Chrome DevTools Protocol, ran the five-step wizard to the end and seeded the vault and first project, then failed the person three ways. The launcher's brain step read "No key for deepseek-official yet. Add one to start here." for every Chat brain, Free included: the wizard's tools step listed every configurable route's catalogue whether or not a key resolved, so the natural first picks were DeepSeek's own models with no DeepSeek key; the agents route fell back to the composed default model when Free's free-tokens route was absent, which the packaged app never registers; and the wizard offered Design, Coding and Admin while the launcher lists five brains, so Writing was never asked about. The tour showed four of its six steps: the files and models steps named the frame's `[data-shell-dock]` row, which is empty in V1 (the panes live on the tool rail in the `shell.rail` seat), so both dropped at every launch, and the closing "bar" step spotlighted that empty row. Nothing in the first run mentioned the Askbar, the Studio, spaces or brains. And once the wizard was fixed and a Coding brain on OpenRouter launched the first chat, that chat's first turn failed with `MISSING_CREDENTIAL`: the activity controller recomposed the blank chat on the brain's preset but wrote the brain's model only for started chats, so the turn went to the deployment default route (DeepSeek, no key) whatever the brain row promised.

## Decision

**The wizard offers only routes that can answer.** `loadTools` keeps a provider only when `/idealize/models/state` reports it connected or free, using the `auth` and `connected` fields the route already served. Writing joins the rows. Free is a tick when the free-tokens route is registered and a model choice like the others when it is not, so the packaged app's first run ends on brains that can start.

**A launch writes the brain's model.** `ActivityPillsController.select` selects the brain's resolved model on the session for a blank chat as well as a started one, after the recompose; the launcher's comment already assumed the controller did this for activity brains, and the first turn now runs on the route the brain row names.

**Free's resolution stands.** `modelOf` in the activity route takes an activity's resolved value even when it is null, and falls back to the override or the composed default only for presets outside the activity table (the coordinator roles). Free with no free route now reads "no model yet" in the launcher instead of another provider's missing key.

**The tour points at the V1 frame and names the new surfaces.** Eight steps: welcome, sidebar, studio, composer (spaces then brains), files, brains, askbar, rail. Selectors resolve through the tool rail's `shell.rail` seat, the Studio card's `data-studio-card-wrap`, and the sidebar's "Collapse to the Askbar" button. The shortcuts sheet lists ⌃⌥A as a listed-only row, since the desktop shell runs it globally.

**Documentation brought level for the V0 archive.** The askbar README gains the width route; activity-pills, onboarding, feedback and the tour READMEs describe the current surfaces; FORK.md says what V0 is and that it is being archived; the 27 Aug handoff carries a superseded banner and the tour handoff is archived; the desktop README gains the landing route, the shell's features and the Finder Quick Action.

## Addendum, the same afternoon: the tools step by space

JJ, on the setup as walked: "the model selection blends chat and terminal, but terminal relies on cli so should be separate - really just asking for the default cli in terminal. also there's not panel for sound model." The tools step had one "Chat and Terminal" group of five model rows and generating rows for Gallery and Motion only; Sound stayed in Brains.

The step now groups by space in the launcher's order. Chat keeps the five model rows. Terminal asks one thing: the default CLI a fresh shell types, read from `GET /idealize/terminal/launches` and offered as the Brains pane's closing Terminal row offers it (installed catalogue entries, a plain shell named as such, a hand-set command shown as its own option), saved whole through `POST /idealize/terminal/launch` only when changed. Where the launches route is absent, a plain browser, the group does not render. Sound Stage joins Gallery and Motion with the persisted `sound` preset and its own recovery sentence. 50 onboarding tests pass.

## Addendum, the walk of the fixed build: the card under the wizard

The fresh-home walk of the packaged build carrying the fixes above passed the wizard, the eight-step tour and the first turn (OpenRouter, `~openai/gpt-mini-latest`, no `MISSING_CREDENTIAL`), and found one more fault: straight after the wizard, New chat → Chat showed every brain "No key for deepseek-official yet" and Free "No model resolves", while `/idealize/activity/agents` already reported the OpenRouter models; a renderer reload showed the right rows. The welcome card reads its access map on mount and again on the `idealize:brains-changed` document event, which only the Brains pane raised; the wizard saved through the same routes and raised nothing, so the card kept the map it read under the overlay before any key existed. The wizard now raises the event after its agents and tools steps commit.

## Addendum, the same afternoon: the tour that started beneath the wizard

Two of five fresh boots of the packaged build showed the tour 4 ms after the wizard unmounted, over the parked opening sequence, with seven cards (no Studio). A 200 ms DOM poll from the first CDP target showed the tour card mounted beneath the wizard about 1.2 s after the wizard itself, on the boots that failed. The tour's first-run trigger ran its check once at apply; when the `idealize-tour` settings snapshot was already ready, it armed its 1.4 s timer before `@idealize/onboarding` (which injects `tour`, so applies later) took its hold, and a hold taken after arming never cancelled the timer. The tour then started under the wizard, computed its steps before the first project existed, and stayed an active overlay occupant, which kept the opening sequence parked. Which way a boot went depended on whether the settings snapshot was ready before the tour plugin applied.

The trigger is now `armFirstRunTrigger` in `ui-tour/src/client/first-run-trigger.ts`: a hold taken while the delay is running cancels it and disarms, and the release re-evaluates from the start. Four tests cover the ready-then-start, hold-before-ready, hold-after-arming and disposer cases; 25 tour tests pass.

## Alternatives considered

**Ask for a DeepSeek key in the agents step.** It would make the offered catalogue honest without filtering, but adds a card for a route JJ's users do not need when OpenRouter or Claude Code is connected, and the Brains pane already takes any key later.

**Hide Free entirely when no free route exists.** The new-chat card lists Free as a brain regardless, so the wizard would then leave one brain unconfigured, which is the fault this walk found.

**Register a `models` anchor from the Brains pane.** `ctx.tour.anchor()` exists for that, but the pane is composed after the tour in some frames and the rail button is the stable element the callout should sit on; the default selector is the right home.

## Consequences

- 48 onboarding, 72 activity-pills and 21 tour tests pass; the three packages lint and typecheck clean; doc budgets pass.
- The fresh-run walk, its screenshots and its driver live in the session scratchpad; the walk's findings are recorded on the board (landing 41).
- Free is a tick when the free-tokens route is registered and a model choice when it is not. The packaged app does register that route (its free-tokens sidecar was running on the 14 Sep walk, so Free rendered as the tick); the model-choice branch serves compositions without it.
