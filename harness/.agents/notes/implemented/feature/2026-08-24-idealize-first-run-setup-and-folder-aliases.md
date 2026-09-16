# Agent Note: First-run setup and the folder-alias seam

Status: implemented

## Problem

IDEalize V1 asks the user for its two working folders once, at first run, and every later surface resolves paths through them (spec §5, SET-01..07, FIL-05). Before this slice nothing captured them: `@idealize/vault` read a `projectsRoot` nobody set, `@idealize/doc-policy` read a `documentationFolder` nobody set, and the only first-run behaviour in the tree was `@idealize/ui-tour`'s showcase, which fired the moment its own seed was unset. A user opening the app for the first time got a tour of features pointed at no project and an unconfigured vault.

## Decision

**Two folders, not three.** JJ's revision of the plan's OQ-01: first run captures the **projects root** (the folder holding every project) and the **documentation** folder (the vault). The plan had proposed capturing the active project and deriving its parent as the projects root. Deriving the root from one project is wrong whenever a user's first project sits somewhere unrepresentative, and it makes the Files "Projects" tab depend on an accident of the first pick. `currentProject` is not an alias at all: orientation creates it under the projects root through `ctx.workspaceRegistry` and the client selects it, so the alias set is exactly `projectsRoot` and `documentation`.

**`ctx.workspaceAliases` is the seam, and resolve re-probes.** `resolve(name)` answers `{name, path, accessState, reason?}` from a live probe on every call, never a cached verdict — a folder on an unmounted drive is the ordinary case, so a consumer that renders a stale `ok` would show a dead tree with no explanation. An unset alias is `undefined`; a set-but-broken one keeps its path with a non-`ok` state, which is what lets the Files tabs (S9) keep the tab and offer Reconnect instead of dropping it. `set(name, path)` probes first and throws `AliasProbeError` with nothing stored, so a stored alias was valid when written.

**A probe is stat + directory + list + write.** Checking existence alone passes folders IDEalize cannot write into, which is the failure the user meets later at the worst moment (a scaffold or a note write). The probe creates and deletes a random dotfile and stops at the first failed check, returning one of `missing`, `not-a-directory`, `unreadable`, `unwritable` with a sentence naming the path and the fix, shown verbatim by the capture UI (SET-04). The macOS privacy-settings route is named in the two permission reasons because that is where the fix actually is.

**Seeding follows the merged packages, not the plan's wording.** The plan has orientation seed `@idealize/vault`'s config from the documentation alias, which predates the doc-policy refactor: `@idealize/vault` now owns `projectsRoot` and `@idealize/doc-policy` owns `documentationFolder`, so each alias seeds the package that holds it today. Orientation writes `@idealize/doc-policy`'s `documentationFolder` and `@idealize/vault`'s `projectsRoot` and refuses with a message naming the missing plugin when either section is unregistered. Silently skipping would leave a user who completed setup with an unscanned vault and no signal. The documentation scan is kicked and awaited so the vault is scaffolded before the flow advances; doc-policy also rescans on its own settings change, so the explicit call only makes the ordering deterministic for callers and tests. A scan failure is logged, not thrown: the alias write stood and is not worth undoing.

**The tour becomes the flow's last step, through a hold rather than a seed.** `@idealize/ui-tour` gained `ctx.tour.holdFirstRun()`, a counted hold that suspends its automatic first-run trigger; releasing the last hold re-evaluates it, so the tour still starts exactly once or not at all. Sequencing by seed instead would have raced: both plugins read their seeds asynchronously, and whichever resolved first would paint. (The setup client that took the hold has since retired; [`@idealize/onboarding`](2026-08-25-idealize-onboarding-skeleton.md) takes it now, with the same release paths.)

**The package is host-only.** Its browser overlay — the orientation card and the model-connection step — retired in favour of `@idealize/onboarding`'s wizard, which drives the folder captures and the orientation call through this package's routes; the package returned to a single compiler face (the two-face split the retired client required is gone with it). The host half's composition test boots the file settings provider, JSON storage, the storage domain, the workspace registry, doc-policy and vault over a scratch home. `tsconfig.base.json` carries source paths for `@idealize/vault` (the composition test imports it) and `@idealize/setup`.

## Alternatives considered

**Registering the whole package in the Client aggregate, like `@idealize/appearance`.** Tried first, since `packages/AGENTS.md` says ordinary two-entry client plugins use one aggregate. It failed on this package while the client half existed: naming the host tests `.client.spec.ts` dragged `@deepseek-ai/dsh-settings-file`, `@deepseek-ai/dsh-storage-json` and `@idealize/vault` into the Client program, and adding project references for them is exactly the host-merge contamination that aggregate refuses. `@idealize/appearance` gets away with it because its host half boots nothing. (The split this alternative lost to is gone now — the client half retired.)

**Asking for the current project as a third folder.** Rejected with OQ-01: it breaks SET-02's exactly-two-folders promise and duplicates `ctx.workspaceRegistry`, which already owns project creation and selection.

**Detecting whether a model is already connected and skipping step 2.** Retired with the client half: the wizard's agents step owns model connection now, and it does detect — Claude Code through the subprocess seam, OpenRouter through the credentials seam.

## Consequences

S9's Files tabs resolve their three roots through `ctx.workspaceAliases` and call `POST /idealize/setup/alias` for Reconnect. S10's documentation work inherits a folder that is already probed, seeded and scanned. `@idealize/ui-tour` now has a public hold on its first-run trigger, so any later first-run step can sequence itself ahead of the showcase the same way — `@idealize/onboarding` does. The `idealize-setup` section is the durable record of what first run captured; nothing renders from it directly anymore (the onboarding wizard's own `idealize-onboarding` section gates the wizard), but its aliases pre-fill the wizard's folder steps.

Route handlers are covered through a real booted web server in the composition test. There is no assembled-application snapshot for this flow: it is a Host-only surface with no model-visible input and no session events, so the snapshot lanes have nothing to record.
