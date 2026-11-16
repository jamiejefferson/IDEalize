# @idealize/setup

First-run orientation and the folder aliases the rest of IDEalize resolves paths through. Setup captures three folders: the **projects root**, which holds every project, the **documentation** folder, the user's vault, and the **skills** folder, one subfolder per skill with a SKILL.md (JJ, 15 Sep 2026). Orientation asks for the first two; the skills folder is captured only through the alias route, by the onboarding wizard's skills step and the Files pane's Skills tab. The current project is never asked as a further folder — it is created or selected under the projects root through `ctx.workspaceRegistry` (SET-02).

## What the plugin does

- **`ctx.workspaceAliases` service** — `resolve(name)` returns the stored path with a live-probed `accessState` and, when that state is not `ok`, a plain sentence fit to show the user; `set(name, path)` probes before it persists and throws `AliasProbeError` without storing on a failure. The alias names are `projectsRoot`, `documentation` and `skills`.
- **A project's documentation folder** — `projectDocumentation(projectPath)` returns the folder chosen for the project, else the one `ctx.docPolicy.projectFolder` finds in the vault (the project note's `repo:` pointer, then `Projects/<project folder name>`), with a live-probed `accessState`; `setProjectDocumentation(projectPath, path)` probes before it stores and rejects with `AliasProbeError`. The Files pane's Documentation view is its caller.
- **Folder probes** — every capture runs stat, a directory check, a listing, and a create-then-delete write probe, stopping at the first failure and naming the path and the fix (SET-04). The verdicts are `ok`, `missing`, `not-a-directory`, `unreadable`, `unwritable`.
- **Orientation** — `orient({projectsFolder, documentationFolder, projectName?})` probes both folders, creates the named first project under the projects root and registers it as a workspace, persists the aliases and the orientation seed, seeds `@idealize/doc-policy`'s `documentationFolder` and `@idealize/vault`'s `projectsRoot`, and awaits the documentation scan (SET-06). A failing field returns in `failures` with nothing persisted.
- **Settings section `idealize-setup`** — the per-component seeds (`orientationDone`, `orientationAt`, `modelsDone`) and the captured folders under `aliases`. A `skills` write seeds `@idealize/skills`' `skillsFolder`. A missing dependent section fails loud naming the plugin that owns it. `projectDocs` holds the documentation folder chosen per project, keyed by the project folder's path; an empty entry is a cleared choice.
- **Routes** (loopback only; mutations require the `x-idealize-auth` header) — `GET /idealize/setup/state` reports the component seeds and the live-probed aliases; `POST /idealize/setup/orientation` runs the capture (the onboarding wizard's finish step calls it); `POST /idealize/setup/alias` re-points one alias — the Files tabs' Reconnect flow (FIL-07), and the onboarding folder steps' live probes, call it. `POST /idealize/setup/project-docs` takes `{project, path}`, probes the folder and stores it as that project's documentation folder; an empty `path` clears the choice. `GET` and `POST /idealize/setup/weekly-review` report and accept the weekly review offer.

## The weekly documentation review

Once a documentation folder is chosen, setup offers a weekly review of it (JJ, 16 Nov 2026). Nothing is scheduled until the person accepts. `POST /idealize/setup/weekly-review` with `{accept: true}` saves one entry in `@idealize/cron`: "Weekly documentation review", Monday at 08:00 in the host's zone, switched on, with the documentation folder as its workspace. `GET` on the same path reports the offer: the folder, the schedule, whether an entry is accepted and switched on, and the two folder lists. Accepting again switches an entry the person had turned off back on and keeps the time they gave it; an entry they deleted counts as not accepted. A chat's key cannot reach the route, so only the person accepts.

The entry's instructions name the bundled `vault-review` skill and carry two settings from the `idealize-vault-review` section:

| Field | Default | Meaning |
|---|---|---|
| `skipFolders` | `[]` | Folders the review neither reads nor reports on. |
| `neverEditFolders` | `['sessions']` | Folders the review may read and never change. The default is the folder of chat transcripts `@idealize/vault` writes. |
| `taskId` | none | The calendar entry the person accepted. |

Each rule is a folder path relative to the documentation folder; a rule that starts with `**/` matches a folder of that name at any depth (`**/Meetings`). A rule that is absolute, empty or holds `..` is refused at the settings write. A changed list, or a `documentation` alias write, rewrites the accepted entry's instructions and workspace; when the calendar refuses the new folder the entry keeps what it had and a warning is logged.

The skill ships in this package at `skills/vault-review/SKILL.md` and is registered by a `@deepseek-ai/dsh-skill-filesystem` child (`providerName: idealize-bundled`, `bundledSkillDir`, no default roots, no watch) while a skill registry is composed.

What holds the review to its limits:

- **Its workspace, in code.** `@idealize/cron` runs every scheduled chat in `workspace-write`, so the chat can change files only inside the documentation folder, and refuses a documentation folder that is the home folder or holds it.
- **The never-edit folders, in code for the `write` and `edit` tools.** While the entry's chat runs (`idealize/cron-run-started` to `idealize/cron-run`), a prepended `fs/write-intent` and `fs/edit-intent` listener refuses any target inside a never-edit folder before the file is touched. Names compare without regard to case. Every other chat passes untouched.
- **Everything else, by the skill's instructions alone.** Never renaming, moving or deleting a note; leaving an unrecognised `type` or `status` as it is and flagging it; skipping the skip folders; and keeping a shell command out of a never-edit folder (the skill tells the model to change files with the file tools only).

The review reads the folder itself. It flags `stale` (a note past `stale_after`), `index-oversize` (a project `_index.md` over 6,000 characters), a missing `description`, and skills with new lines in `Reference/playbook-learnings/<skill>.md`, under the same names `@idealize/doc-policy`'s scan uses, without reading the scan's findings. It writes `Reference/Weekly Reviews/YYYY-MM-DD-review.md`. `tests/review-fixture.ts` builds a small folder with one planted case for each.

## Headless seam

The package is host-only: its browser overlay retired in favour of `@idealize/onboarding`'s five-step wizard, which drives the folder captures and the orientation call through this package's routes. The tour hold and the first-run gating moved with it.

## Model Experience

### The bundled `vault-review` skill

#### What the model sees

One line in the `skill` tool's catalogue on every chat, the skill's frontmatter name and description, registered through `@deepseek-ai/dsh-skill-filesystem`. A chat that loads the skill receives the body of `skills/vault-review/SKILL.md` as `@deepseek-ai/dsh-tool-skill` documents: the two settings, the limits that always apply, and five steps (find the notes changed in 7 days, safe fixes, flags, the review note, a three-line reply).

##### The catalogue line

```markdown
vault-review: Weekly review of the documentation folder. Fixes missing frontmatter, links and index lines on notes changed in the last 7 days, flags what needs the person's judgement, and writes a dated review note. Use when asked to run the weekly documentation review or a vault review.
```

#### Token effect

One catalogue line of about 55 words on every request that carries the `skill` tool. The body, about 1,400 words, enters only a chat that loads it.

#### KV Cache effect

Prefix-stable: the catalogue line is constant for a build, so it does not invalidate reuse. A loaded body is appended after the reusable prefix.

### The weekly review's instructions

#### What the model sees

One user message per fire in the review's own scheduled chat, sent by `@idealize/cron` after its scheduled-chat notice. `<skip>` and `<never-edit>` are each list written as backticked rules separated by commas, or `none`.

##### The instructions

```markdown
Run the weekly review of this documentation folder. Load the `vault-review` skill with the skill tool and follow it exactly.

Settings for this run:
- Folders to skip: <skip>
- Folders never to edit: <never-edit>
```

#### Token effect

About 40 words plus the two lists, once per fire. No other chat receives it.

#### KV Cache effect

Independent: each fire is a new session with its own prefix.

### A refused change in a never-edit folder

#### What the model sees

In the review's chat only, a `write` or `edit` call on a file inside a never-edit folder fails with `The weekly review may not change files in "<rule>", so <path> was left as it was. Report what you found there under Flagged and carry on.`

#### Token effect

One sentence per refused call.

#### KV Cache effect

Append-only: the failure follows the reusable prefix.

## Known Limitations and Deferred Work

- **No surface lists the weekly review's two folder lists.** The offer itself shows in the first-run wizard and, for a person who finished setup before it existed or passed it by, as a suggestion in the Schedule pane (`@idealize/ui-schedule`, JJ, 16 Nov 2026). `skipFolders` and `neverEditFolders` are edited in the settings file.
- **A shell command can still write into a never-edit folder.** The refusal covers the `write` and `edit` tools; the sandbox confines a shell command to the documentation folder and knows nothing of the list. The skill tells the model to use the file tools only.
- **Never renaming a note rests on the skill's instructions.** No code compares the folder before and after a run.
- **A rewritten entry loses hand edits to its instructions.** A changed folder list or documentation folder replaces the accepted entry's instructions with the generated ones.
- **A chat the review starts is not held to the never-edit list.** The refusal keys on the review's own session.

- Changing an alias after first run has no settings surface yet: `POST /idealize/setup/alias` is the only way in, and the Files tabs' Reconnect button (S9) is its first caller.
- Orientation creates at most one project. Selecting an existing folder under the projects root as the first project goes through the ordinary project picker after the flow ends.
- The `modelsDone` seed is legacy: the retired overlay's model step wrote it; the wizard's agents step records its own outcomes in `idealize-onboarding.steps`.
