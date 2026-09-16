# Agent Note: the retired lead agent's preset is removed at startup

Status: implemented

JJ, 7 Sep 2026: "remove the lead agent row."

## Problem

The lead agent role was retired on 1 Sep for the group chat ([note](../feature/2026-09-01-lead-role-retired-for-group-chat.md)), and `RETIRED_ROLE_PRESETS` in `@idealize/spaces` gave its preset no space so it sat under the Brains pane's Agent roles section as "Lead Agent" beside the Project Coordinator. The pane has no delete action, so the row stayed on every install that had seeded the preset, and the retirement note had left deleting it as the user's call. JJ made the call.

## Decision

`@idealize/activity-pills` runs `retiredRolePresetsToRemove` at startup, after seeding and before the composition repair: each id on `RETIRED_ROLE_PRESETS` that sits in the editable roster with no stored space list is deleted through `agentPresets.remove`, which also clears a default that pointed at it, and one `info` line names the removal. A retired preset with a stored space list was placed in a space by the person after the retirement, so it is theirs and stays. A second start finds nothing to remove.

## Alternatives considered

**Delete the preset directory on JJ's disk by hand.** Every install that ran the seeding before 1 Sep carries the same row; the startup pass clears them all and the pane needs no delete action for a role nobody can add back.

**Drop `lead-agent` from `RETIRED_ROLE_PRESETS`.** That puts a retired role's chat back in every chooser on an install where the preset still exists; the list keeps the id and the startup pass removes the preset.

## Consequences

The Agent roles section lists the Project Coordinator alone on JJ's install. A person who placed the Lead Agent in Chat keeps it, under Chat. Tests: `gen-fixture/tests/agent-composition.host.spec.ts` (the startup removal over a real roster, and the pure rule).
