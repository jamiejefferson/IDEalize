# @idealize/vault

Commit-evidence documentation over the canonical structure `@idealize/doc-policy` owns, host only. The documentation folder, its scaffold and the session-start context injection live in `ctx.docPolicy`; this plugin keeps the write side and one reconcile route. Mounted by the `idealize` profile as the `idealize-vault` row, injecting `docPolicy`.

## What it writes

On `session/flush`, throttled to once per 15 seconds per session, `documentClose` finds the project note whose `repo:` matches the session's git toplevel and reads the commits since the note's own `last_touched` (`commitsSince`, no merges, oldest first). `appendSessionLog` (`src/notes.ts`) appends them to `log.md` beside the note and advances the note's `last_touched`; that line is the only change to `_index.md`.

`log.md` (`src/log.ts`) is created on the first entry with `type: log`, `project` and `created` in its frontmatter. It holds one `## YYYY-MM-DD` heading per day, in date order, and one line per commit under the commit's day: the short hash in backticks, then the subject in double quotes on one line. Lines are only ever inserted; nothing already in the file is rewritten or reordered.

A commit whose hash already appears in `log.md`, or anywhere in the note (a legacy `## Session log` section included), is skipped; with nothing new both files stay byte-identical. A successful append triggers `ctx.docPolicy.scan()` so the documentation index stays fresh. Failures are logged and never thrown into session teardown. The work runs detached from the flush (the flush is the durability barrier a turn's first step waits on, and a git read behind another process's index lock must not hold it) and is awaited at the plugin's disposal, so a final flush before teardown still lands the evidence. Flush starts it because dispose reaches this late-mounted plugin only after its own disposal.

## Chats that commit nothing

IDEalize is built for designers, who often work without committing, so a chat that changes files and commits nothing also gets a line. `workingState` (`src/uncommitted.ts`) reads `HEAD` and `git status --porcelain=v1 -z` for the chat's repository, with each uncommitted path's size and modification time. The first reading is taken on the chat's first save in this run of the app, before the chat's first tool call. On every later save that passes the 15-second window the reading is taken again, and a file counts as changed when it is uncommitted now and its status, size or modification time differs from the first reading. A file that was already uncommitted and that the chat left alone counts for nothing.

When the count is above zero and `HEAD` has not moved, `log.md` gains one line under today's heading:

```markdown
- "Chat title": 3 files changed (uncommitted). [Transcript](sessions/2026-11-16-chat-title-abcd1234.md)
```

The line is built from those facts with no model call. The link points at the chat's Markdown copy and is left off when no copy exists. A chat has one such line however often it saves: a later save replaces the line where it stands when the count, the title or the copy's name changed. A line an earlier run of the app wrote for the same chat is recognised by the copy's name and kept as it is. A commit made later in the chat gets its usual line, and the uncommitted line stays as the record of what came before it.

`git status` runs with `GIT_OPTIONAL_LOCKS=0`, so the reading never takes the index lock. When the documentation folder is inside the repository, its files are left out of the reading, since the log and the chat's copy are written there. A reading that fails is logged and the chat's commit evidence is still written.

## Settings (`idealize-vault`)

| Field | Default | Meaning |
|---|---|---|
| `projectsRoot` | none | The projects root folder. `@idealize/setup` writes it when the first-run flow captures the projects-root alias; the documentation folder is `docPolicy`'s own `idealize-docs` section. |
| `sessionFiles` | `true` | Keep a Markdown copy of each chat under the project's `sessions/` folder. `GET` and `POST /idealize/vault/settings` read and write it. |

## Routes (loopback only)

`GET /idealize/vault/reconcile` returns `{configured, stale}`: the notes whose repositories have commits newer than their `last_touched` that neither the note nor its `log.md` records (`reconcile`). `configured: false` with an empty list when no documentation folder is set.

`POST /idealize/vault/migrate-log` with `{"note": "<path of a project _index.md>"}` and the `x-idealize-auth: 1` header moves that note's legacy `## Session log` section into its `log.md` (`migrateSessionLog`) and answers `{moved, log}`. It is the one write a person starts: no session event and no schedule calls it. The section's list items move, a dated item (`- YYYY-MM-DD …`) under its day and any other under `## Undated`; an item whose commit hash the log already holds is not added twice. Other lines a person wrote in the section stay in the note, the two lines the template shipped there are removed, and the heading keeps one line, `The session log is in [log.md](log.md).` The route answers 404 for any path that is not `Projects/<name>/_index.md` inside the configured documentation folder, 409 with no folder set, and leaves a note with nothing to move byte-identical.

## Model Experience

#### What the model sees

Nothing directly, and no model is asked for anything: every line this package writes is built from git and the filesystem. `@idealize/doc-policy` owns the model-visible text: its session-start map names `log.md` on one line with the file's size, and `docs_search` returns the log's lines, uncommitted lines included.

#### Token effect

The log's size no longer reaches a chat. A project index carries no log, so it stays inside the session-start map's budget for longer; the map spends one line of about 150 characters on `log.md`.

#### KV Cache effect

A commit changes `log.md`'s size and the note's `last_touched`, and an uncommitted line changes `log.md`'s size, so the map `doc-policy` injects at the next session start differs by those two values; nothing here alters a running session's request.

## Known Limitations and Deferred Work

- **No button calls the migrate route yet.** `POST /idealize/vault/migrate-log` is the whole action; the Files pane has no control for it, so a person reaches it through an agent or a later interface.
- **A legacy `## Session log` section stays where it is until migrated.** New commits go to `log.md` from the first append, so an unmigrated project has log lines in both files; the hash check reads both.
- **An uncommitted line counts files and names none.** It says how many files changed and links the chat's copy; which files, and what changed in them, is in the working tree and the copy.
- **The first reading is the chat's first save in this run of the app.** A chat reopened after a restart is measured from the restart, and a chat with no Markdown copy (`sessionFiles` off, or nobody has spoken) can gain a second line after a restart, because its first line carries no link to recognise it by.
- **A chat that commits gets no line for what it leaves uncommitted afterwards.** Once `HEAD` moves, the commit lines are the chat's record.
- **Another program's edits count.** The reading covers the repository, so a file the person or a second chat changed during the chat is counted with the chat's own.
- **A project outside git gets no log lines.** Its chats still get their Markdown copies.
- **`projectsRoot` is stored but not read here.** The section exists so `@idealize/setup` has a durable home for the alias; the tabs in `@idealize/ui-bar`'s Files pane read the alias through `workspaceAliases`, not this section.
- **Matching is by git toplevel.** A project note whose `repo:` names a path that is not the exact toplevel of the session's working directory is never found, and a worktree resolves to its own toplevel rather than the main checkout's note.
