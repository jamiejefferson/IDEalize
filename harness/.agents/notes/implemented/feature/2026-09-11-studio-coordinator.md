# Agent Note: the Studio gets a coordinator, and stops shouting at every project

Status: implemented

JJ asked what a typed message in the Studio chat actually does, then read the answer off the screen before I finished checking: "its literally posting to all the agents! thats not right. it should post to the studio agent - which is a coordinator - unless a specific agent is tagged".

## Problem

The Studio chat's composer is the ordinary one, and `agent/pre-step` takes the message before any model runs. A leading `@name` delivered to that one agent. Anything else was recorded as a group message on **every** stored project's timeline, one record per project keyed `<messageId>:<projectKey>`. Three consequences, all visible in the app:

- a line JJ typed once appeared on every project's timeline, tagged with a project he had not been talking about;
- `wakeCoordinator` fires on a group post, so every project's coordinator woke at once and read a message aimed at none of them;
- nothing held the conversation. The Studio had no agent of its own, so a question asked there had no one to answer it, and the reply (if any) came back from whichever project coordinator chose to speak.

The Studio bar also carried the open project's name as a chip, which said the opposite of what the Studio is: one view across every project.

## Decision

**A second coordinator role, at a different altitude.** `CommRole` becomes `'project-agent' | 'studio-agent'`. A project coordinator runs one folder and is found by that folder; the Studio coordinator runs the Studio, runs in the harness home because the Studio's records live there and it owns no project's files, and is found by the role alone because there is exactly one. Everything the role system already did per-role now reads from a map rather than a constant: `ROLE_TITLES`, `ROLE_OPENING`, `PERSONAS`, `presetOfRole`/`roleOfPreset`, and `roleGuide`, which now reads `skills/<role>/SKILL.md`. `RoleConfig` gains `studioAgentPreset` (default `studio-agent`), settable like the project one, and both presets seed on first boot.

**An untagged Studio post goes to that agent, on the Studio's own timeline.** `postFromChat` finds a running `studio-agent`, starts one with `spawn --studio` when none runs, and delivers the message to it with `project: STUDIO_PROJECT` — the bare word `studio`. Every other timeline key is an absolute project folder, so the sentinel cannot collide with one, and the store's `projectKey()`/`storedProjects()` round-trip it like any other key. A `@name` post is unchanged: it still delivers to that agent on its own project.

**A failed start is told to the user, not just the log.** `postFromChat` answers `{ kind: 'no-coordinator', reason }` when no mailbox half is composed or the spawn fails, and the pre-step listener pushes a bridge `notify` saying the message was not posted — the same treatment an unresolvable `@name` already got. A message that reaches no timeline must never look sent.

**The Studio's own timeline is named.** The view rendered `projectName('studio')` as the bare word among real folder names; it now reads "Studio".

**The project chip comes off the Studio's ask bar.** `HeroLauncher` already returned `null` for a Studio chat with no project open; it now returns `null` for a Studio chat outright. A Studio chat is launched by construction, so the two launch steps never ran there anyway, and the chip named a project the Studio does not belong to.

## Alternatives considered

**Post to the project coordinator of whichever project the Studio bar names.** The chip was already there, so the routing would have been one line. It makes the Studio a second composer for one project, which is the opposite of a view that watches all of them, and it leaves a question about two projects with nowhere to go.

**Keep the fan-out but wake only one coordinator.** This fixes the noise in the mailboxes and none of the noise on the timelines: the typed line still appears under every project, tagged with projects the person was not talking about.

**Give the Studio no agent and answer nothing.** Honest, and what the build effectively did once the fan-out came out, but JJ asked for a coordinator by name, and a chat that records the user's words and never replies reads as broken.

## Consequences

- `CommSessionInfo.role` widens to `'project-agent' | 'studio-agent' | 'chat'`; `@idealize/askbar`'s two structural mirrors widen with it.
- `resolveTarget` gains the alias `studio-agent`, resolved by role with no folder to disambiguate, answering "the Studio coordinator is not running" when none is.
- `wakeCoordinator` is untouched and now does less: it matches a `project-agent` whose `cwd` equals the event's project, and the `studio` key matches no folder, so a Studio post wakes no project coordinator. The Studio coordinator is invoked directly by the delivery instead.
- `skills/studio-agent/SKILL.md` tells that agent it does no project work: it routes with `idealize send`, reads with `idealize list` / `idealize studio` / `idealize board --path`, and always answers on the Studio timeline with `idealize post`.
- The Studio chat itself still never lists in the roster and is still never named. The coordinator is an ordinary chat that does.

## Evidence

`packages/idealize/studio/tests/studio-chat.spec.ts` covers the three routes: an untagged post spawns a coordinator once and lands on `studio` alone with no project timeline touched; a coordinator already on the roster is reused with no spawn; a spawn that fails posts nothing and notifies. `comm/tests/roles.spec.ts` covers the per-role preset mapping and the separate guide, `comm/tests/resolve.spec.ts` the alias, `comm/tests/service.spec.ts` that `spawn --studio` answers the running coordinator rather than starting a second. `ui-bar/tests/hero-launcher.client.spec.tsx` asserts the card renders nothing for a Studio chat with a project open, and `ui-studio/tests/studio-view.client.spec.tsx` that the Studio's own timeline is headed "Studio".
