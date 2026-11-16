# Agent Note: a chat starts with a map of its project's notes, the session log lives in its own file, and a chat that commits nothing still leaves a line

Status: implemented

JJ approved the knowledge and playbooks scope on 16 Nov 2026, including the move of the session log to `log.md` (decision D2) and the optional `description` field (D1).

## Problem

`@idealize/doc-policy` handed a starting chat the first 6,000 characters of the project's `_index.md`. The project-index template ends with Decisions, Traps and the session log, and those sections only grow, so the clip removed exactly the parts a chat most needs to know exist. In JJ's vault on 16 Nov 2026, 23 of 66 project indexes ran past 6,000 characters, and the largest was 136 KB with 106 KB of decisions. A chat on that project read part of its Status section and was never told the note held decisions at all. Nothing told any chat which other notes sat in the project's folder.

`@idealize/vault` wrote to a project's notes only when a chat ended with commits. IDEalize is built for designers, who often work without committing, so their chats left no trace in the project's log however much they changed.

## Decision

**The notice is a map built from named parts.** `src/session-context.ts` splits the index at its `## ` headings. An index that fits arrives whole. A longer one contributes its frontmatter, its opening lines, State (or Status), Next actions, and the first line of each Open threads item. Every other section gets one line under `Left out of this map:` with its size, the note's path and the search to use. A cut inside a section says so on its own line. Nothing is dropped without a line that says what and where.

**The notes beside the index are listed.** Each Markdown file in the project folder gets one line: its name and its frontmatter `description`, else its first heading. The list is newest first by modification time, with the name as the tiebreak. When it overflows, the oldest entries go and one line counts them. Only the first 4,096 bytes of each note are read.

**The whole notice has one ceiling.** `NOTICE_CEILING` is 8,000 characters, measured on the complete message: opening sentence, conventions, block wrapper and map. The note list is promised 1,800 characters; State, Open threads and Next actions share the rest 40/35/25, and what a short section leaves goes to the list.

**The text depends on the files alone.** No part of the builder reads the clock, and the list order comes from modification times and names. Two chats started on unchanged files receive identical notices, so a provider's cached prefix covers both.

**The map stays reference data.** It sits inside the existing `<project-note>` block. The left-out lines are written as statements of where text is, and note text that imitates the block's tags is broken up before the map is measured, so the escaping cannot push the notice past its ceiling.

**A terminal agent gets the same map.** `terminalKnowledge(cwd)` ends with the map for a project that has a note, capped at `TERMINAL_MAP_LIMIT` (6,000 characters), with `rg or grep` named where a chat is told `docs_search`.

**The session log is `log.md` beside the index.** `@idealize/vault`'s `appendSessionLog` writes commit evidence there: one `## YYYY-MM-DD` heading per day in date order, one line per commit with the short hash first. The file is created on the first entry with `type: log`, `project` and `created`. The index changes only in `last_touched`. A hash found in `log.md` or anywhere in the index is skipped, so a project with a legacy `## Session log` section gains no duplicates. `doc-policy` classifies the file as `project-log`, and the map names it on its own line and keeps it out of the note list.

**Moving an existing log is the person's choice.** `POST /idealize/vault/migrate-log` moves one note's legacy section into `log.md` and leaves the heading with a link. Nothing calls it from a session event or a schedule. It follows the package's existing pattern for a person's action, the loopback `POST /idealize/vault/settings` route with the `x-idealize-auth` header, and it rewrites only a `Projects/<name>/_index.md` inside the configured documentation folder.

**A chat that changes files and commits nothing gets one line.** `src/uncommitted.ts` reads `HEAD` and `git status --porcelain=v1 -z` on the chat's first save, with each uncommitted path's size and modification time, and compares later readings with it. A file counts when it is uncommitted now and differs from the first reading, so work that was already uncommitted and untouched counts for nothing. With a count above zero and `HEAD` unmoved, `log.md` gains `- "<title>": <n> files changed (uncommitted). [Transcript](sessions/<file>)` under today's heading. The line is built from git and the filesystem with no model call. Later saves replace that line where it stands; a line from an earlier run of the app is recognised by the transcript's file name and kept.

## Alternatives considered

**Raising the clip.** A 136 KB index does not fit any clip a session should pay for, and a larger clip still ends at an arbitrary character.

**Summarising the index with a model.** It costs a request at every session start, and the text would differ between two starts on the same files, which loses the cached prefix.

**Ordering the note list by a frontmatter date.** Few notes carry one, so most of the list would fall back to another key and the order would mix two rules.

**Naming the note's path once, above the left-out lines.** It saves about 100 characters a line. The approved scope asks for the path on each line, and a model that reads one line out of context still learns where the section is.

**Dropping the conventions from the notice.** The standing prompt section already tells every chat to read `CONVENTIONS.md`, and the 1,472 characters would go to the map. The scope did not ask for it, so the conventions stay.

**A `migrate_session_log` tool.** An agent could then move a log when asked in chat. A tool is a schema in every request, and an agent may call it without being asked, which breaks the rule that a person's notes move only on the person's word.

**Migrating every note at the first append.** One pass would end the two-file state. It rewrites notes nobody asked to have rewritten.

**Sorting and rewriting `log.md` on each append.** The file would always be tidy. A line a person added by hand would move or vanish, so every write inserts lines and changes nothing else.

**Comparing `git status` lines alone.** A file that was modified before the chat and modified again during it has the same status line both times, so the chat's work on it would count for nothing. The size and modification time make the difference visible.

**Listing the changed files in the line.** The names are useful, and a long list makes the log hard to scan. The line carries the count and a link to the chat's copy.

**Writing the line once and never updating it.** The first save that sees a change comes seconds after the chat's first edit, so the count would describe the start of the work. Replacing the chat's own line keeps one line and a count that is current at the last save.

**Taking the first reading on `agent/session-start`.** It is earlier by a moment. The vault's work already starts on `session/flush`, the first flush comes before the chat's first tool call, and a second event would add a dependency on the agent package.

## Consequences

A project whose index is long loses the tail of its State section from the notice when State runs past its share; the cut line says so. Traps are named and sized but not shown, as the scope specifies, so a chat reads the note before work that a trap could affect. The note list follows modification times, so a sync tool that rewrites every file's time reorders the list once. Until a person migrates a project, its older log lines stay in the index and count against the index's size; the migrate route has no button yet. The uncommitted count covers the whole repository, so edits by the person or by another chat during the chat are counted with it.
