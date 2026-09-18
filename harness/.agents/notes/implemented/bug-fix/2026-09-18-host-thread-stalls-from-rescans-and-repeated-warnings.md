# Agent Note: Host-thread stalls from documentation rescans and repeated skill warnings

Status: implemented

## Problem

JJ reported beachballs in IDEalize V1 (18 Sep 2026). The Host runs on Electron's main thread, so synchronous Host work freezes every window. Two recurring sources were measured on his machine. First, `@idealize/doc-policy` rescanned the whole documentation folder on `session/flush`, throttled to once per 15 s per session: each rescan read 802 Markdown files (5.98 MB), rebuilt the in-memory FTS5 index synchronously (76-83 ms blocked per rebuild in a standalone benchmark of the same steps) and rewrote the 158 KB `idealize_docs.json` history, although the folder had not changed; the 20 kept history rows were all from the same hour with identical counts (809 documents, 31 findings). Second, the skill registry logged one warning per shadowed duplicate on every catalogue rebuild. JJ has 58 duplicates, the desktop log sink appends synchronously, and the log timestamps put a median 8 ms between consecutive lines (n = 1,485), so each rebuild blocked the Host thread for 0.8-3.8 s; 13 rebuilds ran on 17 Sep. These warnings were 1,881 of the week's log lines.

## Decision

`DocPolicy.scan()` fingerprints the folder before scanning. `fingerprintFolder` hashes exactly what `scanFolder` reads: the root listing, every directory and `.md` file under the canonical directories with size and modification time, and the local date, because the stale-note rule compares `last_touched` with today. An equal fingerprint for the same folder returns the last record and skips reading, indexing and recording. The fingerprint is taken before the scan, so an edit that lands mid-scan changes the next fingerprint and is picked up then. The skill registry keeps a set of reported duplicates keyed by name and source and warns once per key for its lifetime; a different shadowed source is still reported.

## Alternatives considered

**A file watcher on the documentation folder.** It removes the periodic walk, but the folder is a whole Obsidian vault (Notes) and the Host already holds one kqueue descriptor per watched skill file; a recursive watcher adds lifecycle and platform cases for a cost the stat walk already makes small.

**A longer flush throttle.** It lowers the rate and keeps every wasted scan; it also delays the index after a real edit.

**Moving the FTS5 index to a worker thread.** It removes the synchronous rebuild for real changes as well. It is a larger change, and with unchanged folders skipped the rebuild runs only after an edit.

**Lowering the duplicate warning to debug.** It hides a real configuration finding the first time as well; once is enough to act on.

## Consequences

An idle folder costs one `readdir` per directory and one `stat` per Markdown file per throttle window, and no write. Scan history now holds one row per change, so 20 rows cover real history. A change that alters neither size nor modification time of a file is not seen until the date rolls or another file changes; editors and git both update the modification time. The duplicate set grows by one string per distinct shadowed skill and source and is never cleared; the count is bounded by installed skills. The synchronous log sink itself is fixed in the desktop repository (burst coalescing); this change removes the repeated burst at its source for every host.

## Evidence

Measured on JJ's live data, read-only: `storages/idealize_docs.json` scan keys 15-40 s apart with identical `docCount`; `logs/dsh-2026-09-1*.log` skill warning bursts of 58-60 lines spanning 807-3,828 ms. Tests: `packages/idealize/doc-policy/tests/scan.spec.ts` (fingerprint sensitivity, ignored inputs, date rollover), `tests/composition.spec.ts` (unchanged folder returns the same record and adds no history row; an edit rescans and is searchable), `packages/skill/skill/tests/skill.spec.ts` (one warning across three rebuilds; a new source warns).
