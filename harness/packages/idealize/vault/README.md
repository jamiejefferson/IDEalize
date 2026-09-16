# @idealize/vault

Commit-evidence documentation over the canonical structure `@idealize/doc-policy` owns, host only. The documentation folder, its scaffold and the session-start context injection live in `ctx.docPolicy`; this plugin keeps the write side and one reconcile route. Mounted by the `idealize` profile as the `idealize-vault` row, injecting `docPolicy`.

## What it writes

On `session/flush`, throttled to once per 15 seconds per session, `documentClose` finds the project note whose `repo:` matches the session's git toplevel, reads the commits since the note's own `last_touched` (`commitsSince`, no merges, oldest first), and appends them to the note's session log, advancing the date (`appendSessionLog`, `src/notes.ts`). Commits whose hash already appears anywhere in the note are skipped; with nothing new the note stays byte-identical. A successful append triggers `ctx.docPolicy.scan()` so the documentation index stays fresh. Failures are logged and never thrown into session teardown. The work runs detached from the flush (the flush is the durability barrier a turn's first step waits on, and a git read behind another process's index lock must not hold it) and is awaited at the plugin's disposal, so a final flush before teardown still lands the evidence. Flush starts it rather than dispose because dispose reaches this late-mounted plugin only after its own disposal.

## Settings (`idealize-vault`)

| Field | Default | Meaning |
|---|---|---|
| `projectsRoot` | none | The projects root folder. `@idealize/setup` writes it when the first-run flow captures the projects-root alias; the documentation folder is `docPolicy`'s own `idealize-docs` section. |

## Route (loopback only)

`GET /idealize/vault/reconcile` returns `{configured, stale}`: the notes whose repositories have commits newer than their `last_touched` (`reconcile`). `configured: false` with an empty list when no documentation folder is set.

## Model Experience

Indirectly, through the project notes it appends to, which `@idealize/doc-policy` injects into session-start context; that package owns the model-visible text.

#### KV Cache effect

An appended session log changes the note `doc-policy` may inject at the next session start, so a later session's system context differs from an earlier one's; nothing here alters a running session's request.

## Known Limitations and Deferred Work

- **Evidence is commits only.** A session that edits files without committing writes nothing to the note; the no-evidence-no-write rule is deliberate, so uncommitted work is undocumented until a commit lands.
- **`projectsRoot` is stored but not read here.** The section exists so `@idealize/setup` has a durable home for the alias; the tabs in `@idealize/ui-bar`'s Files pane read the alias through `workspaceAliases`, not this section.
- **Matching is by git toplevel.** A project note whose `repo:` names a path that is not the exact toplevel of the session's working directory is never found, and a worktree resolves to its own toplevel rather than the main checkout's note.
