# Agent Note: the skills folder, captured in setup and shown in Files

Status: implemented

JJ, 15 Sep 2026: "i think having a pre-defined skills folder, visible in files, like projects and documentation, would be super useful as it would mean only skills needed for the task could be referenced. so i'd love if that could be added (in this plus icon modal, in files, and in initial setup)". This note covers the folder itself: setup, the Files pane and the host package. The composer's + menu is the `ui-conversation` composer-menu change.

## Problem

Skills reached a chat only through the harness's conventional roots (`~/.dsh/skills`, a project's `.agents/skills`), which a person never chooses and the app never shows. JJ keeps skills in a folder of their own and wants to see it beside Projects and Documentation, pick it once at first run, and have a chat reference only the skills a task needs.

## Decision

`@idealize/setup` resolves a third workspace alias, `skills`, through the same probe, persist and seed path as the other two. Orientation still asks for the two folders the first project needs; the skills folder is captured only through the alias route, by the onboarding wizard's new `skills-folder` step (after the documentation step, before finish, sharing the documentation owl until its own is drawn) and by the Files pane's Reconnect flow. A `skills` write seeds the new `idealize-skills` settings section.

`@idealize/skills` is a new host package that owns that section (`skillsFolder`). While the folder is a readable directory it mounts `@deepseek-ai/dsh-skill-filesystem` as a child plugin with `includeDefaultRoots: false`, `customSkillDirs: [folder]` and `watch: true` under the provider name `idealize-skills`, into the host skill registry's global layer, which every agent's catalogue and `skill.list` read. Reconciles run one at a time in settings order; a changed folder disposes the old provider and mounts a new one, and an unset, missing or non-directory value leaves nothing mounted. The section registers without the registry, so setup can seed it in any composition. The bundle row sits after `idealize-vault` in `bundle-idealize/cordis.patch.yml`.

`@idealize/ui-bar`'s Files pane gains a fourth tab, Skills, over the `skills` alias, with the same listing fence, Reconnect card and row actions as the other alias tabs.

Per-task scoping of the model's catalogue is not built. The catalogue lists every skill in the folder by name and description; only a skill the person references from the + menu, or the model loads through the `skill` tool, has its body join the chat.

## Alternatives considered

- **Enable the host `skill-filesystem` row with the folder in `customSkillDirs`.** That reads the conventional roots too, which the web-app bundle deliberately leaves to presets, and a cordis.yml path is not something the app's own setup can write. A settings-owned child mount keeps the folder a product setting.
- **Ask for the skills folder in orientation.** Orientation exists to create the first project, which needs the projects root and the vault; a third required folder would block a first run for a person with no skills yet. The step is skippable and the alias route captures it later.
- **A per-chat skill scope built now.** The registry is host and per-scope layered, so a per-task layer is possible, but the + menu already gives the person the reference JJ asked for; scoping the catalogue is deferred until a task shows the catalogue itself is the problem.

## Consequences

Every skill in the folder is one catalogue line in every chat's `skill` tool description, and a folder edit invalidates the cached prefix from the tool block onward on the next request. The onboarding wizard is six steps and six dots. The owl clip generator maps `skills-folder` to the documentation clip through a `SHARED` table, so the generated file carries no duplicate data URI.

## Testing

`packages/idealize/skills/tests/skills.spec.ts` boots a real settings document and skill registry over a temp folder holding `<name>/SKILL.md`: a stored folder's skills appear in `ctx.skills.list()`, a changed folder re-mounts, a cleared folder empties the registry, a missing or non-directory value mounts nothing, and disposing the plugin removes the provider. `setup.spec.ts` seeds the section through `set('skills', …)` and reads it back through `state()`. The ui-bar alias and Files pane specs cover four tabs; the onboarding specs cover six steps, the skills step's probe and the finish after it.

## Packages, not folders (later on 15 Sep)

JJ, once the folder was live: "i think the folders in skills should be ignored as they aren't the actual skill files - they're the unpackaged skills." JJ's folder holds 58 `.skill` packages (zip archives with a SKILL.md at the root, the format skills are shared in) beside four unpacked copies, and the provider read only the four. The plugin now unpacks each package into `unpackFolder` (`<dsh home>/idealize/skill-packages` by default; a marker with the source's size and mtime skips unchanged packages; a vanished package's subfolder is removed; escaping entries are dropped; a package without a manifest is skipped with a warning), mounts the provider over that folder, and watches the skills folder so a package dropped in, replaced or removed reaches the catalogue without a restart. Subfolders and `.zip` files in the skills folder are ignored. `tests/skills.spec.ts` covers the package path, the ignored folder, the watch, the nested manifest, the missing manifest and the traversal guard.

## Subfolders per model (later still on 15 Sep)

JJ: "change of plan on the skills list. i need subdirectories for the models to use. i've created a couple in the skills folder. these should be incorporated in the skill selector modal. also can you create a claude folder and put a copy of the claude skills into it?" The folder now held `Codex/` (the 58 packages), an empty `hermes/` and `WIP Skills/` (unpacked folders and zips). `@idealize/skills` reads packages from the folder and one level of subfolders, unpacks a subfolder's packages under `unpackFolder/<subfolder>/`, and mounts the provider over the unpack folder plus each subfolder in use, in case-insensitive name order; the folder watch is recursive and a new subfolder re-mounts. Because the registry keeps one skill per name (rank, then provider order, then discovery order), a name present in two subfolders runs from the first subfolder by name, and the registry warns about the other on each collect. The selector therefore cannot come from the registry alone: JJ's `claude/` folder is a copy of `Codex/` by name, and a registry-fed list would have shown `claude` empty. The plugin provides `ctx.idealizeSkills.catalogue()`, the packages as they sit on disk with their unpacked manifests, and `GET /idealize/bar/skills` marks each entry `invocable` from the registry; the submenu shows one heading per folder and disables a package the registry refused. The `claude/` folder was filled by zipping each of the 59 `~/.claude/skills/*` folders that carry a SKILL.md into `<name>.skill` (`jacq-project-setup` has none and was skipped). `JacqSKFeature` stays refused in every folder: its frontmatter is invalid YAML.
