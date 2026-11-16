# @idealize/skills

The person's own skills folder as product settings, and the rules that decide which skills one chat is offered, host only. JJ (15 Sep 2026): "a pre-defined skills folder, visible in files, like projects and documentation, would be super useful as it would mean only skills needed for the task could be referenced". The settings section `idealize-skills` keeps the folder, and while it is a readable directory the plugin mounts one `skill-filesystem` provider over it into the host skill registry. A brain's skill list narrows that folder for chats on the brain, and a project's `playbooks/` folder reaches chats working in that project. Agents record what they learn about a skill through the `skill_learning` tool, and the shipped `fold-learnings` skill drafts a revision from those learnings for the person to review. Mounted by the `idealize` profile as the `idealize-skills` row.

## What it mounts

The folder holds skills in two layouts. A `.skill` package is a zip archive with a `SKILL.md` (frontmatter `name` and `description`, then the body) at the root or under one top-level folder, plus any references and assets, the format skills are shared in. An unpacked skill is a folder holding a `SKILL.md`, the layout Claude Code and Codex keep, so a person's existing skills work once copied in. Both sit directly in the folder or in one level of subfolders, one per model (JJ, 15 Sep 2026: "i need subdirectories for the models to use"; JJ's folder holds `Codex/` and `claude/`).

An unpacked folder is accepted when no package beside it has the same name, compared without case; the package wins a clash (JJ, 16 Nov 2026). This narrows JJ's rule of 15 Sep 2026, which ignored every unpacked folder because her folder keeps the unpacked copy of each package beside it ("the folders in skills should be ignored as they aren't the actual skill files - they're the unpackaged skills"): those copies still clash with their packages and are still ignored. A visible folder directly in the skills folder that holds a `SKILL.md` and no package is an unpacked skill; any other visible folder there is a subfolder of skills. Everything else is ignored: deeper folders, hidden folders, loose files, and `.zip` files.

The plugin stages each source under `unpackFolder/<name>/`, or `unpackFolder/<subfolder>/<name>/` for a source in a subfolder: a package is unpacked and a folder is copied whole, so the person's own folder is only ever read. A `.package` marker records the source's change key (size and mtime for a package, a digest of every file's path, size and mtime for a folder), so an unchanged source is not staged again; a source that goes takes its staged copy with it, and a subfolder's staged copy goes once it holds nothing; archive entries that would escape the folder are dropped; a source that cannot be staged is skipped with a warning and leaves no partial copy. The plugin mounts `@deepseek-ai/dsh-skill-filesystem` as a child plugin with `includeDefaultRoots: false`, `customSkillDirs` set to the unpack folder followed by each subfolder in use (case-insensitive name order), `watch: true` and the provider name `idealize-skills`. The registry keeps one skill per name, first root first, so a name that appears in two subfolders resolves to the first subfolder by name (the registry warns about the other); the catalogue below still lists both. The skills folder is watched recursively (a 300 ms settle after the last change), so a package or folder dropped in, edited, replaced or removed reaches the registry without a restart; a new subfolder re-mounts the provider with the extra root. The mount waits for the `skills` service, so the section registers whether or not the registry is composed. A changed folder disposes the old provider and mounts a new one; clearing the folder, or pointing it at a path that is missing or is not a directory, leaves nothing mounted. Reconciles run one at a time in the order the settings changed.

## Which skills a chat is offered

Every chat reads the host registry's global layer, where the folder's provider sits, merged with the layer of the brain it runs on. Two registrations narrow and extend that set per chat.

### A brain's skill list

A brain is an agent preset, and its `preset.yml` may carry `skills`, the names of the skills it offers from the person's folder ([`@deepseek-ai/dsh-agent-presets`](../../preset/agent-presets/README.md#display-metadata) reads and stores the list):

```yaml
name: Design
skills:
  - brief-writer
  - deck-reviewer
  - moodboard
```

A chat on that brain is offered those folder skills, the brain's own skills (whatever its composition registers, including the project and user roots its `skill-filesystem` row reads), the project's playbooks and the skills that ship with IDEalize. A brain with no list is offered every folder skill, and an empty list offers none. The list selects by the skill's `name`; a name the folder does not hold is ignored.

The plugin applies the list as a view filter on the registry (`ctx.skills.registerFilter`, [`@deepseek-ai/dsh-skill`](../../skill/skill/README.md)), so the session catalogue, the `skill` tool, a typed `/name` and the composer's `skill.list` all agree: a skill the list leaves out cannot be listed or loaded in that chat. `brainSkillFilter` finds the brain through the viewing scope (`presetOfScope`: the scope's nearest preset standing key among `livePresetMounts()`), which is the composition the chat runs, and reads the list from that preset's `preset.yml` on every read, so an edit to the file takes effect at the chat's next request. A view outside every preset, and a preset the roster no longer holds, are not narrowed. The filter registers when both `skills` and `agentPresets` are composed.

### A project's playbooks

A project's folder inside the documentation folder may hold `playbooks/`: skills written for that project, as `playbooks/<name>/SKILL.md` or a flat `playbooks/<name>.md`. `PlaybooksProvider` registers as `idealize-playbooks` in the global layer and answers by the chat's working directory: it takes the project root (`projectRootOf`: the nearest folder at or above the working directory holding `.git`, else the working directory), asks `ctx.docPolicy.projectFolder` ([`@idealize/doc-policy`](../doc-policy/README.md)) for that project's documentation folder, and lists `<that folder>/playbooks`. A chat whose working directory belongs to no documented project is offered none. Each playbook carries `source: 'project-playbooks'` and rank 150, so within the global layer a playbook wins a name over a skill from the person's folder; a skill of the same name in the brain's own layer (the repository's `.agents/skills/`, say) still wins, because the registry resolves the nearer layer first. The provider keeps one `FileSystemSkillProvider` per playbooks folder, watching it whether or not it exists yet, so a playbook written during a chat is listed at the next request. It registers when both `skills` and `docPolicy` are composed.

The repository's own `.agents/skills/` needs no mount from this package. The `standard` preset every Chat and Terminal brain derives from carries a `skill-filesystem` row with its default roots, which read `<project root>/.dsh/skills`, `<project root>/.agents/skills`, `<dsh home>/skills` and `~/.agents/skills` for the chat's working directory. `includeDefaultRoots: false` applies only to the provider this package mounts over the person's folder.

## Learnings

A skill improves from what each use teaches. The loop has three parts, and the person stays the one who changes a skill.

**Recording.** The `skill_learning` tool appends one line to `Reference/playbook-learnings/<skill>.md` inside the documentation folder (`ctx.docPolicy.folder()`), in this exact format, which `@idealize/doc-policy`'s weekly review reads to list skills with new learnings:

```text
- YYYY-MM-DD (<brain>/<model>): <text>
```

The date is the host's local calendar day. `<brain>` is the brain the chat's log records (`foldBrain`, [`@idealize/spaces`](../spaces/README.md)), else the preset the chat runs on; `<model>` is the model of the chat's latest `request/header`; either reads `unknown` when the log names none, and whitespace and brackets in them become `-` so the line keeps its format. `<text>` is the learning with every run of whitespace collapsed to one space, so a learning is always one line. A missing file is created first, with `type: log`, `created` and `description` frontmatter and a `# Learnings: <skill>` heading. The tool only appends (`appendLearning`): it opens no existing line for writing, and when a person's edit left the file without a final line ending it starts a new line first. The first write of two chats racing to create a file writes one header.

The tool refuses, with an error the model reads, a `skill` that is not a valid skill name (lowercase letters, digits and single hyphens, which is what keeps the file inside the learnings folder), a skill the calling chat is not offered, an empty learning, and a learning over 500 characters. With no documentation folder set it writes nothing and answers `No documentation folder is set, so the learning was not recorded. Tell the user what you learned instead.`

**Prompting.** A standing system-prompt section, `idealize:skill-learnings` at order 123 (straight after `idealize:documentation`), says when to call the tool. The tool and the section register together, when `skills`, `docPolicy`, `tools` and `systemPrompt` are all composed.

**Folding.** The package ships the `fold-learnings` skill in its own `skills/` directory (`skills/fold-learnings/SKILL.md`, published through the manifest's `files`), mounted as a second `skill-filesystem` child with `bundledSkillDir` set to that directory and the provider name `idealize-built-in-skills`. A brain's skill list never hides it. The skill has the model read a skill's learnings and its current `SKILL.md`, then write one file, `Reference/playbook-learnings/<skill>.proposed.md`: the changes each learning caused, the learnings left out, and the complete revised `SKILL.md`. Its instructions forbid every other write, including to the learnings file and to the skill. The person reviews the proposal, replaces the skill's `SKILL.md` and repacks.

## The catalogue service

`ctx.idealizeSkills.catalogue()` answers the folder as it sits on disk, for the composer's Skills & Commands submenu (`@idealize/ui-bar`): one group per folder, the skills folder's own packages and accepted unpacked folders first (`folder: ''`), then each subfolder by name, each group's entries sorted by name; a subfolder without skill sources is absent. Each entry carries the package's file name without its extension or the unpacked folder's name (`package`), the staged manifest's `name` and `description`, and `manifest: true`; a source whose staged manifest is missing, has no frontmatter, does not parse or lacks either field is listed by its file or folder name with `manifest: false` and an empty description, so the person sees it and the selector can leave it unoffered. The catalogue lists the folder whatever brain a chat runs: a brain's skill list narrows the registry, and this service reads the disk. The catalogue is empty when no folder is set or the folder is unreadable, whatever the unpack folder still holds. `readCatalogue(folder, unpackFolder)` and `syncPackages(folder, unpackFolder)` (which returns the failures and the subfolders in use) are exported for the tests.

## Settings (`idealize-skills`)

| Field | Default | Meaning |
|---|---|---|
| `unpackFolder` | `<dsh home>/idealize/skill-packages` | Where packages are unpacked and unpacked folders copied for the provider to read. |
| `skillsFolder` | none | The skills folder of `.skill` packages and unpacked skill folders, directly or in one level of subfolders. `@idealize/setup` writes it when the `skills` alias is captured (the Files pane's Skills tab and the onboarding wizard's skills step both go through that alias); a cordis.yml `config.skillsFolder` is the composition default the stored value overrides. |

## Model Experience

### The skill catalogue of one chat

#### What the model sees

Nothing this package writes itself. Each registered skill reaches the model as one line of the session skill catalogue, `- \`<name>\`: <description>`, which [`@deepseek-ai/dsh-tool-skill`](../../skill/tool-skill/README.md) injects as a user-role reminder and replaces when the set changes; a skill the model loads through the `skill` tool, or the person references from the + menu, has its body enter the conversation as that package documents. This package decides which lines one chat's catalogue holds: the skills staged from the person's folder, narrowed to the brain's `skills` list when its `preset.yml` carries one, plus the playbooks of the project the chat's working directory belongs to. A `skill` call for a name the chat's catalogue does not hold fails with `skill "<name>" is unknown or no longer available`.

#### Token effect

One catalogue line per offered skill, in the catalogue message, with each description clipped at 500 characters by `dsh-tool-skill`. A brain that lists three skills from a folder of sixty carries three folder lines in place of sixty. A project with playbooks adds one line per playbook to chats in that project and nothing to other chats. A loaded skill costs its body once, as for any registered skill.

#### KV Cache effect

The catalogue is a message in the conversation and stays out of the system prompt and the tool schemas, so it leaves the cached prefix before it untouched. An unchanged set costs nothing between turns. A change to the set (a package, folder or playbook added, removed or re-described, or an edit to the brain's `skills` list) appends one replacement catalogue message at the chat's next request; earlier messages stay cached.

### The `skill_learning` tool

#### What the model sees

One tool schema, `skill_learning`, with parameters `skill` (string, required, "The exact name of the skill the learning is about, as the available skills list gives it.") and `learning` (string, required, "One sentence, at most 500 characters: what the skill's step said and what was true instead."). Its description reads: `Record one thing you learned about a skill while using it: a step that proved wrong, missing or out of date. The learning is appended as one dated line to that skill's learnings file in the user's documentation folder, where the user reviews it before the skill changes. This tool only adds a line; it never changes the skill or an earlier learning.` A successful call returns `Recorded in Reference/playbook-learnings/<skill>.md:` and the appended line; with no documentation folder it returns the sentence quoted under Learnings; a refused call returns its error text.

#### Token effect

Fixed schema cost on every request of every chat whose composition reads the host tool layer: 758 characters as the JSON schema the request carries. Each call adds its arguments and a result of two short lines.

#### KV Cache effect

Prefix-stable: the schema text is constant, and it joins the tool block once. Results are append-only tool output after the reusable prefix.

### The standing `idealize:skill-learnings` section

#### What the model sees

One system-prompt section at order 123, in every chat, with constant text:

##### Standing learnings line

```markdown
When a step in a skill you loaded proves wrong, missing or out of date, complete the task the correct way, then call the skill_learning tool once with the skill's name and one sentence that says what the step said and what was true instead. Record only what you observed in this chat. Never edit a skill's own files to correct it.
```

#### Token effect

Fixed: 330 characters per request.

#### KV Cache effect

Prefix-stable: the text never varies with the folder, the brain or the session.

### The shipped `fold-learnings` skill

#### What the model sees

One line in the session skill catalogue of every chat that carries the `skill` tool: the skill's name and its description (`Draft a revised SKILL.md for one skill from the learnings agents recorded about it, and save the draft as <skill>.proposed.md beside the learnings file for the user to review. Use when the user asks to fold, apply or review a skill's learnings, or to improve a skill from what agents learned.`). The body in [`skills/fold-learnings/SKILL.md`](skills/fold-learnings/SKILL.md) reaches the model only when the skill is loaded.

#### Token effect

One catalogue line of 312 characters per chat. Loading the skill adds its body once, 3,491 characters.

#### KV Cache effect

The line is part of the catalogue message, which is constant while the offered set is unchanged. A loaded body is tool output after the reusable prefix.

## Known Limitations and Deferred Work

- **A brain's list is edited by hand.** The list lives in `preset.yml` under the brain's folder in the preset root; the Brains pane keeps it on save and offers no control for it.
- **The list follows the composition the chat runs.** A started chat switched to another brain keeps its first brain's composition ([`@idealize/spaces`](../spaces/README.md)), so it keeps that brain's skill list too.
- **Playbooks appear only once the project is documented.** A chat whose project gains its first note, or whose documentation folder setting changes, is offered the playbooks after the next registry invalidation (any skill change, or a restart); a playbooks folder that is created later inside an already documented project is picked up by its watcher.
- **One watcher set per playbooks folder.** The provider keeps a watching filesystem provider for every project asked about during a run and releases them together when the plugin is disposed.
- **Names clash by staged name and by skill name.** An unpacked folder is skipped only when a package beside it carries its folder name; a folder and a package under different file names whose manifests declare the same skill `name` both stage, and the registry keeps the first root's.
- **Nothing runs the fold on its own.** A person asks for `fold-learnings`; the weekly review lists the skills with new learnings and leaves the folding to them.
- **The one-file rule of `fold-learnings` is an instruction.** The skill's text tells the model to write the proposal file alone; no code stops a model that ignores it, and the tests pin the instruction, since a keyless test cannot observe a model following it.
- **A learning is attributed from the log.** A chat on a deployment with no preset roster records `unknown` as its brain.
- **`skill_learning` has no anchored tool-catalog section.** The catalog generator globs `packages/*/tool-*`, so the schema is quoted above.
- **One folder.** The section stores a single path; a second skills root needs a `skill-filesystem` row of its own.
