# Agent Note: A shared settle helper for IDEalize's rendered proofs

Status: implemented

## Problem

Two packages landed after the rendered proofs were written and broke every one of them.

`@idealize/onboarding` replaced `@idealize/setup`'s client overlay with a five-step first-run wizard at `shell.overlay` order 95. The retired overlay's `[data-setup-skip]` hook went with it, so the ui-bar welcome proof (then `welcome-modes-proof.mts`, now `packages/idealize/ui-bar/proof/welcome-spaces-proof.mts`) clicked a selector that matches nothing: on a first-run home it photographed the wizard and reported a pass. Measured on a fresh scratch home, that recipe left `[data-idealize-onboarding]` on screen at step `agents`, with `[data-setup-skip]` present 0 times and `[data-onboarding-skip-all]` present once.

`@idealize/ui-launch` added the opening sequence at `shell.overlay` order 10: a logo layer, then the sidebar sliding in from the left and the chat column from the right, gated on `body[data-idealize-launch="playing"]`. No proof outside `.idealize/proof-launch.mjs` and `.idealize/proof-onboarding.mjs` waited for that attribute to clear, so a capture could land mid-slide and still pass.

The second fault is worst exactly where a proof does most of its work. The launch machine parks while any other overlay occupant renders, so on a first-run home the sequence does not play at page load at all — it plays from the moment first-run clears. It then needs `LAUNCH_DWELL_MS` (250) + `LAUNCH_SEQUENCE_MS` (850) = 1100ms, which no wait calibrated against navigation can predict.

## Decision

`.idealize/proof-settle.mjs` holds both waits, plus the showcase tour that arrives behind them.

`watchLaunch(page)` installs an init script before navigation that records when `body[data-idealize-launch]` first appears and when it goes. The history has to be recorded rather than read, because a post-hoc read of the attribute cannot tell "not armed yet" from "already done" — and the first of those is the mid-animation window. `settle(page, options)` then waits for the first-run wizard or a finished sequence (one wait covers the race, since a live wizard parks the machine), drives any wizard off through `[data-onboarding-skip-all]` or per-step `[data-onboarding-skip-step]`, waits for the sequence to have armed AND cleared with its layer unmounted, and finally waits out the tour's trigger window. `assertSettled(page, name)` guards an individual capture. `openApp(page, url, options)` does navigation and settle together so `watchLaunch` cannot be forgotten.

Every wait is event-driven. The one derived duration is the tour deadline: ui-tour starts the showcase `FIRST_RUN_DELAY_MS` (1400) after the first-run hold releases, which is the same moment the launch machine arms, so the helper waits until `armedAt + 1400 + 400ms` of render slack or until the tour appears, whichever comes first. Without that wait the tour's scrim lands after the launch settles and intercepts the proof's next click — how `brains-presets-proof.mts` failed on the first run of this change.

Every timeout throws with the observed page state attached and the words `NOTHING WAS CAPTURED`, so a proof cannot fall through to a screenshot. `settle` also refuses a page that never ran `watchLaunch`, and refuses a `prefers-reduced-motion` page, where the machine starts settled and there is nothing to wait for.

### Home

The helper lives in `.idealize/` because that is the only place both proof conventions can import from. `packages/idealize/*/proof/*.mts` runs under tsx and `.idealize/proof-*.mjs` runs under plain node, so the shared module has to be plain ESM JavaScript with JSDoc types; a `.ts` module cannot be imported by the node-run scripts. `.idealize/` is already the proof harness's home — nine scripts and the `proof/` output directory — and it sits outside the TypeScript programs, oxlint's file set (which ignores `**/*.mjs`), knip, publint and the per-file coverage gate, none of which should be asked to carry a script that ships to nobody.

## Alternatives considered

**A new `packages/idealize/proof-kit` workspace.** It would give the helper a package README and a tsconfig, and it would also drag `pnpm run test:coverage`'s per-file 100% rule, `pnpm run hygiene`'s knip and publint checks, and the workspace-constraint gate onto a file whose only consumers are two directories of scripts. The cost is real and the benefit is naming.

**A `.mts` helper under one package's `proof/` directory.** The `.mts` proofs could import it, but `.idealize/proof-*.mjs` runs under plain `node` with no TypeScript loader and could not. Converting those six scripts to tsx to suit the helper's file extension inverts the dependency.

**Reading `body[data-idealize-launch]` at settle time instead of watching from an init script.** Absent is the state both before the sequence arms and after it finishes, so a proof that happened to call late would pass instantly on an unsettled page. The init-script watcher is what makes the two distinguishable.

**Adding a settled marker to `@idealize/ui-launch` for proofs to wait on.** It would make the wait a one-liner, but it puts test scaffolding in a shipped package to save a helper twenty lines, and the machine's existing attribute already carries the fact.

**Leaving the showcase tour to each proof's Escape loop, as before.** The loops are unreliable by construction: they run when the proof happens to reach them, and the tour fires on its own timer 1400ms later. Deriving the deadline from ui-tour's own constant makes the wait correct rather than lucky.

## Consequences

Every rendered proof in the repo now shares one first-run and one launch wait, so the six later slices of the spaces-and-brains reshape inherit them rather than each re-deriving a sleep. A proof that hits an unexpected first-run state fails loudly with the DOM it saw instead of shipping a plausible wrong picture.

The ui-bar welcome proof gained a setup step it did not have: it registers a scratch directory as a workspace over the host's `workspace.create` RPC and selects it, because the welcome card only asks its questions inside a project and a skipped wizard creates none. Its module doc previously claimed the run drove `POST /idealize/setup/orientation` for this; the code never did, and the route's overlay has since retired. That proof was rewritten as `welcome-spaces-proof.mts` when the card became two steps, keeping this setup step verbatim.

Settling costs about 1.8s per navigation on a warm local server, most of it the tour deadline. That is the price of a capture that is true on a cold start and on the packaged window, where the sequence plays later than it does here.

`.idealize/proof-launch.mjs` and `.idealize/proof-onboarding.mjs` keep their own direct waits: they are the proofs of those two surfaces and cannot delegate to a helper that dismisses them. `ui-gallery` and `ui-soundstage` serve their own harness page with no shell, no overlay slot and no launch sequence, so they need no settle; `settle`'s `expectLaunch: false` covers that case if such a proof ever grows a shell.
