# Agent Note: the lead role retires; the group chat takes its place

Status: implemented

JJ's 1 Sep decision, second half (the first — unaddressed messages as group posts — landed separately): the lead agent is retired, the ladder keeps its rungs with the group chat as its conduit, and the project note retires into a coordinator's group-chat post.

## Problem

The lead was a whole tier: a fleet-wide singleton chat with its own preset, guide, alias, spawn flag, mailbox protocol (rung lines "upward"), cross-project note read, and a Brains pane row. Its supervision traffic was invisible to the user (mailboxes) and duplicated what the Studio timeline now shows everyone.

## Decision

**One role remains.** `CommRole` narrows to `'project-agent'`; a stored `'lead'` role is dropped on load (the migration the retirement wants, per the pre-release stance). `spawn --lead`, the `lead`/`lead-agent` alias, `leadPreset` (settings, roles route, Brains row) and the lead guide are deleted; only the coordinator preset is seeded.

**The group chat is the conduit.** `idealize post` writes an unaddressed `message` to the Studio timeline through `studioCommand`; `idealize chat [--last N]` reads the recent messages back. `idealize rung` records the board and posts its status line to the group chat in one act — the old `--to` mailbox delivery is gone. `broadcast` is deleted: invisible fan-out into every mailbox is exactly what the visible group chat replaces.

**The note retires.** `idealize note`, `composedNote`, `setProjectNote`, `projectNotePath` and the store's `notes` section are deleted; the coordinator posts the project brief to the group chat, and per-chat state is the rung line.

**The vocabulary follows.** `waiting-on-lead` becomes `waiting-on-coordinator` (wire and askbar chip states). The coordinator guide's upward-wire section is rewritten onto the group chat, with JJ's verbosity rule embedded: one-line posts, detail in a vault doc referenced from the post. `$IDEALIZE_LEAD_AGENT` — an env var nothing ever set — goes with it.

## Alternatives considered

**Keep the lead as an optional tier.** Rejected: JJ retired the concept explicitly, and an optional tier keeps every dual-role branch (spawn singleton rules, alias resolution, two guides) alive for a role nobody runs.

**Rename the lead's machinery onto the coordinator.** Rejected: the coordinator already existed with its own machinery; the lead's distinctive parts (fleet board, cross-project note read, `LIVE?` escalation protocol) presuppose a tier above projects that no longer exists.

**Keep `broadcast` beside `post`.** Rejected: two ways to address everyone, one visible and one not, invites the invisible one. A message for everyone belongs where the user can see it.

## Consequences

- An existing seeded `lead-agent` preset in user data sat under the Brains pane's Agent roles section as "Lead Agent" until 7 Sep 2026, when JJ ruled "remove the lead agent row": `@idealize/activity-pills` now deletes it at startup while no space list is stored for it, and keeps one the user placed in a space ([note](../bug-fix/2026-09-07-retired-lead-agent-preset-removed-at-startup.md)).
- Group posts still wake nobody; the coordinator reads the chat when woken by the existing triggers. A dedicated group-post wake trigger remains open work.
- The `Agent-Comms-Protocol.md` vault doc the guides cite still describes the three-tier wire; the guide now wins in practice, and the vault doc needs its own rewrite from JJ's side of the vault.
