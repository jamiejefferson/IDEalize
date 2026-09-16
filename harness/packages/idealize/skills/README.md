# @idealize/skills

The person's own skills folder as product settings, host only. JJ (15 Sep 2026): "a pre-defined skills folder, visible in files, like projects and documentation, would be super useful as it would mean only skills needed for the task could be referenced". The settings section `idealize-skills` keeps the folder, and while it is a readable directory the plugin mounts one `skill-filesystem` provider over it into the host skill registry, so every chat's skill catalogue and `skill.list` list the folder's skills. Mounted by the `idealize` profile as the `idealize-skills` row.

## What it mounts

The folder holds `.skill` packages: zip archives with a `SKILL.md` (frontmatter `name` and `description`, then the body) at the root or under one top-level folder, plus any references and assets, the format skills are shared in. Packages sit directly in the folder or in one level of subfolders, one per model (JJ, 15 Sep 2026: "i need subdirectories for the models to use"; JJ's folder holds `Codex/` and `claude/`). Everything else is ignored: deeper folders, unpacked copies of the same skills sitting beside their packages, and `.zip` files (JJ, 15 Sep 2026: "the folders in skills should be ignored as they aren't the actual skill files - they're the unpackaged skills"). The plugin unpacks each package into `unpackFolder/<package name>/`, or `unpackFolder/<subfolder>/<package name>/` for a package in a subfolder (a `.package` marker records the source's size and mtime, so an unchanged package is not re-extracted; a package that goes takes its unpacked folder with it, and a subfolder's unpacked copy goes once it holds nothing; entries that would escape the folder are dropped; a package without a manifest is skipped with a warning) and mounts `@deepseek-ai/dsh-skill-filesystem` as a child plugin with `includeDefaultRoots: false`, `customSkillDirs` set to the unpack folder followed by each subfolder in use (case-insensitive name order), `watch: true` and the provider name `idealize-skills`. The registry keeps one skill per name, first root first, so a name that appears in two subfolders resolves to the first subfolder by name (the registry warns about the other); the catalogue below still lists both. The skills folder is watched recursively (a 300 ms settle after the last change), so a package dropped in, replaced or removed, in the folder or a subfolder, reaches the registry without a restart; a new subfolder re-mounts the provider with the extra root. The mount waits for the `skills` service, so the section registers whether or not the registry is composed. A changed folder disposes the old provider and mounts a new one; clearing the folder, or pointing it at a path that is missing or is not a directory, leaves nothing mounted. Reconciles run one at a time in the order the settings changed.

## The catalogue service

`ctx.idealizeSkills.catalogue()` answers the folder as it sits on disk, for the composer's Skills & Commands submenu (`@idealize/ui-bar`): one group per folder, the skills folder's own packages first (`folder: ''`), then each subfolder by name, each group's packages sorted by name; a subfolder without packages is absent. Each entry carries the package's file name, the unpacked manifest's `name` and `description`, and `manifest: true`; a package whose unpacked manifest is missing, has no frontmatter, does not parse or lacks either field is listed by its file name with `manifest: false` and an empty description, so the person sees the package and the selector can leave it unoffered. The catalogue is empty when no folder is set or the folder is unreadable, whatever the unpack folder still holds. `readCatalogue(folder, unpackFolder)` and `syncPackages(folder, unpackFolder)` (which returns the failures and the subfolders in use) are exported for the tests.

## Settings (`idealize-skills`)

| Field | Default | Meaning |
|---|---|---|
| `unpackFolder` | `<dsh home>/idealize/skill-packages` | Where the packages are unpacked for the provider to read. |
| `skillsFolder` | none | The skills folder of `.skill` packages, directly or in one level of subfolders. `@idealize/setup` writes it when the `skills` alias is captured (the Files pane's Skills tab and the onboarding wizard's skills step both go through that alias); a cordis.yml `config.skillsFolder` is the composition default the stored value overrides. |

## Model Experience

### Skills from the person's folder

#### What the model sees

Nothing this package writes itself. The mounted provider registers each unpacked package's `SKILL.md` in the host skill registry, so the `skill` tool's catalogue lists the skill's frontmatter `name` and `description` beside every other registered skill, and the `skill.list` RPC the composer's + menu reads returns the same names. A skill the person references from the + menu, or that the model loads through the `skill` tool, has its body enter the conversation exactly as `@deepseek-ai/dsh-tool-skill` documents; this package adds no text of its own to any request.

#### Token effect

One catalogue line per skill in the folder inside the `skill` tool's description, on every request that carries the tool. A loaded skill costs its body once, as for any registered skill.

#### KV Cache effect

A folder edit changes the `skill` tool's description on the next request, which invalidates the cached prefix from the tool block onward, in the same way as any other skill registration; an unchanged folder costs nothing between turns.

## Known Limitations and Deferred Work

- **Every skill in the folder joins every chat's catalogue.** JJ's aim, referencing only the skills a task needs, holds at the body level: the catalogue lists names and descriptions, and only a skill the person references from the + menu (or the model loads through the `skill` tool) has its body join the chat. Per-task scoping of the catalogue itself is not built.
- **One folder.** The section stores a single path; a second skills root needs a `skill-filesystem` row of its own.
