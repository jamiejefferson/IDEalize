# @idealize/setup

First-run orientation and the folder aliases the rest of IDEalize resolves paths through. Setup captures three folders: the **projects root**, which holds every project, the **documentation** folder, the user's vault, and the **skills** folder, one subfolder per skill with a SKILL.md (JJ, 15 Sep 2026). Orientation asks for the first two; the skills folder is captured only through the alias route, by the onboarding wizard's skills step and the Files pane's Skills tab. The current project is never asked as a further folder — it is created or selected under the projects root through `ctx.workspaceRegistry` (SET-02).

## What the plugin does

- **`ctx.workspaceAliases` service** — `resolve(name)` returns the stored path with a live-probed `accessState` and, when that state is not `ok`, a plain sentence fit to show the user; `set(name, path)` probes before it persists and throws `AliasProbeError` without storing on a failure. The alias names are `projectsRoot`, `documentation` and `skills`.
- **Folder probes** — every capture runs stat, a directory check, a listing, and a create-then-delete write probe, stopping at the first failure and naming the path and the fix (SET-04). The verdicts are `ok`, `missing`, `not-a-directory`, `unreadable`, `unwritable`.
- **Orientation** — `orient({projectsFolder, documentationFolder, projectName?})` probes both folders, creates the named first project under the projects root and registers it as a workspace, persists the aliases and the orientation seed, seeds `@idealize/doc-policy`'s `documentationFolder` and `@idealize/vault`'s `projectsRoot`, and awaits the documentation scan (SET-06). A failing field returns in `failures` with nothing persisted.
- **Settings section `idealize-setup`** — the per-component seeds (`orientationDone`, `orientationAt`, `modelsDone`) and the captured folders under `aliases`. A `skills` write seeds `@idealize/skills`' `skillsFolder`. A missing dependent section fails loud naming the plugin that owns it.
- **Routes** (loopback only; mutations require the `x-idealize-auth` header) — `GET /idealize/setup/state` reports the component seeds and the live-probed aliases; `POST /idealize/setup/orientation` runs the capture (the onboarding wizard's finish step calls it); `POST /idealize/setup/alias` re-points one alias — the Files tabs' Reconnect flow (FIL-07), and the onboarding folder steps' live probes, call it.

## Headless seam

The package is host-only: its browser overlay retired in favour of `@idealize/onboarding`'s five-step wizard, which drives the folder captures and the orientation call through this package's routes. The tour hold and the first-run gating moved with it.

## Model Experience

None, as the plugin stores folder aliases and orientation seeds and serves loopback routes; `@idealize/doc-policy` owns the documentation context the seeded `documentationFolder` later feeds.

#### KV Cache effect

Independent: nothing here enters a chat request; the documentation context derived from the seeded folder is `@idealize/doc-policy`'s append-only notice.

## Known Limitations and Deferred Work

- Changing an alias after first run has no settings surface yet: `POST /idealize/setup/alias` is the only way in, and the Files tabs' Reconnect button (S9) is its first caller.
- Orientation creates at most one project. Selecting an existing folder under the projects root as the first project goes through the ordinary project picker after the flow ends.
- The `modelsDone` seed is legacy: the retired overlay's model step wrote it; the wizard's agents step records its own outcomes in `idealize-onboarding.steps`.
