# Agent Note: Skills scoped by brain and project

Status: implemented

JJ approved the knowledge and playbooks scope on 16 Nov 2026, including decision D5: an unpacked `SKILL.md` folder is accepted when no `.skill` package has the same name.

## Problem

[`@idealize/skills`](../../../../packages/idealize/skills/README.md) mounted every package of the person's skills folder into the skill registry's global layer, so every chat's catalogue carried one line for every skill the person owned. JJ's folder holds about sixty. A brain built for design work listed the same sixty as a brain built for code, and the model chose among all of them on every task.

Two more gaps sat beside that one. A project had nowhere to keep skills written for it alone. And the folder accepted only `.skill` packages, so a person arriving with a folder of Claude Code or Codex skills (each a folder holding a `SKILL.md`) saw an empty catalogue until they zipped every one.

## Decision

**A brain names the folder skills it offers, in its `preset.yml`.** A brain is an agent preset, and `PresetMetadata` gains an optional `skills` list ([`@deepseek-ai/dsh-agent-presets`](../../../../packages/preset/agent-presets/README.md)). No list places no limit; an empty list offers none. The roster reads the list onto `AgentPreset.skills`, `renderPresetMetadata` writes it back, `copy()` keeps it, and the Brains pane's save route (`@idealize/activity-pills`) writes back the list it read. The list lives with the preset because a preset is its directory: a copied brain carries its list with it.

**The list is applied where a chat reads the registry.** `dsh-tool-skill` asks the registry three times per agent (`snapshot` for the catalogue, `list` and `get` for the `skill` tool, `get` for a typed `/name`), each time with `scope: agent`, and the composer's `skill.list` asks a fourth. The registry merges the global layer with the viewing scope's chain and offers no way to take a global entry away from one view, so `SkillRegistry` gains `registerFilter(filter)` ([`@deepseek-ai/dsh-skill`](../../../../packages/skill/skill/README.md)). A `SkillViewFilter` receives one view's winning summaries with its view options and returns the subset that view keeps. The registry applies every filter inside `snapshot()`, `list()` and `get()`, after layers and ranks have chosen each name's winner and outside the catalogue cache. Every consumer therefore agrees, and a hidden skill cannot be loaded by a caller that skips the catalogue.

**`@idealize/skills` registers the filter that reads a brain's list.** `brainSkillFilter` finds the brain from the viewing scope (`presetOfScope`: the nearest preset standing key in the scope's chain, among `livePresetMounts()`), reads `preset.yml` through `readPresetMetadata`, and removes the skills of the `idealize-skills` provider the list does not name. Skills from any other provider pass: the brain's own, a project's playbooks.

**A project's playbooks come from its documentation folder.** `PlaybooksProvider` registers as `idealize-playbooks` in the global layer and answers by the lookup's working directory: project root, then `ctx.docPolicy.projectFolder`, then `<that folder>/playbooks`. The lookup is keyed by working directory, the way the filesystem provider's project roots are, so a chat in the project lists them and a chat elsewhere does not, with no per-session mount to create and dispose. Playbooks carry rank 150, ahead of the folder's custom roots at 300.

**The repository's `.agents/skills/` is already read.** The `standard` preset every Chat and Terminal brain derives from carries a `skill-filesystem` row with default roots, which include `<project root>/.agents/skills`. `includeDefaultRoots: false` belongs to the one provider `@idealize/skills` mounts over the person's folder. Nothing was added for it.

**An unpacked skill folder is staged like a package.** A visible folder holding a `SKILL.md`, directly in the skills folder or in one of its subfolders, is copied whole into the unpack folder under its own name, with a change key computed from every file's path, size and mtime. A folder is skipped when a package beside it carries its name, compared without case. Staging through the existing unpack folder keeps one provider, one set of roots, one cleanup rule and one catalogue reader, and the person's folder is only ever read.

## Alternatives considered

- **Filter inside `dsh-tool-skill`.** The catalogue and the `skill` tool would agree with each other and disagree with `skill.list`, which the composer's + menu reads through the registry; a skill hidden from the model would still be offered to the person, who would then load it into the same chat. `packages/AGENTS.md` asks for a decision to be enforced in the operation that makes it.
- **Let the folder's provider read the viewing scope.** `list(options)` receives the borrowed options object, which holds `scope` at run time. The provider contract names `SkillLookupOptions` alone, and a provider that read past it would break under any registry change that stopped forwarding the object.
- **Mount the folder into each brain's layer.** A layer is written through a context carrying that scope, which the standing mount owns. The host would need a way to add rows to every preset's composition, which is a larger change than a filter and would stage the folder once per brain.
- **Keep the list in the `idealize-activity-pills` settings section beside `models` and `spaces`.** Settings would need no generic change. The scope asked for the preset's metadata, and a list in settings stays behind when a brain is copied.
- **Add the skills folder itself as a provider root for unpacked folders.** A root also reads loose `.md` files with frontmatter as flat skills, cannot leave out one child folder, and would have the registry warn once for every unpacked copy that sits beside its package in JJ's folder.
- **A provider mounted per session for playbooks.** The registry already keys discovery by working directory, and a session-scoped mount would add a lifecycle to create and dispose for each chat while listing the same folder.

## Consequences

- A brain with a list of three folder skills carries three folder lines in its chats' catalogue. A brain with no list is unchanged.
- The list is edited by hand in `preset.yml`; the Brains pane has no control for it.
- A filter runs on every registry read, and `brainSkillFilter` reads one small file per read so an edit takes effect at the chat's next request. The registry cannot emit `skills/change` for that edit, so a consumer that caches a snapshot sees it at its next read.
- An unpacked folder's skill is read from its staged copy, so its resource base is the unpack folder, as it is for a package.
- A project gains playbooks only after it has a documentation folder; the provider's answer for an undocumented project is cached until the next registry invalidation.

## Verification

- `packages/skill/skill/tests/skill.spec.ts`: filters narrow `snapshot`, `list` and `get`, run outside the cache, and stop on disposal.
- `packages/preset/agent-presets/tests/metadata.spec.ts` and `authoring.spec.ts`: the list is read, rendered, and kept on copy.
- `packages/idealize/gen-fixture/tests/agent-composition.host.spec.ts`: a Brains pane save keeps the list.
- `packages/idealize/skills/tests/scoping.spec.ts`: a brain listing three skills is offered those three plus its own; a brain with no list is offered all; a project's playbooks reach chats in the project and no other.
- `packages/idealize/skills/tests/skills.spec.ts`: an unpacked folder registers, a package of the same name wins, and edits inside the folder restage it.
