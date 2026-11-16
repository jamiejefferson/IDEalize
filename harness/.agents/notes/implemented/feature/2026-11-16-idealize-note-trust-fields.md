# Agent Note: Notes say who wrote them, who checked them, and when they expire

Status: implemented

## Problem

A note in the user's documentation folder read the same whether a person had confirmed it or an agent had drafted it an hour earlier, and a note about last spring's prices read as current. `docs_search` handed agents all of them with equal weight. JJ's own conventions also gave opposite answers on who writes `last_touched`, kept the session log inside `_index.md` where it pushed Decisions and Traps past the session-start clip, and the review tooling rewrote `type` and `status` values it did not recognise. JJ approved the six decisions in the knowledge and playbooks scope on 16 Nov 2026.

## Decision

**Conventions (re-pin).** The canonical repository gains optional fields on any note with the Open Knowledge Format 0.2 names (`description`, `generated`, `verified`, `stale_after`, `sources`), names `log.md` beside `_index.md` as the session log, states who writes `last_touched` in JJ's wording, and limits the closed `status` list to a project `_index.md`. The generator reads `NOTE_OPTIONAL_FIELDS` from the conventions example and fails loud when one of the five is missing. It leaves the canonical repository's `Agents/` tree out of `CANONICAL_DIRS`: that tree is the repository's own inter-agent message store, and including it would have scaffolded an `Agents/` folder into every user's documentation folder.

**Validation.** `validateDoc` checks the trust fields on a note of any kind and raises warnings only. A small reader in `src/trust.ts` accepts the forms the fields are written in (flow mapping, block mapping, block list) and reports anything else as a finding, so a malformed value can never throw.

**Advisory findings.** `stale` and `index-oversize` come from the scan, as warnings. The weekly review reads those two names.

**The stamp.** `generated` is written by the host on `fs/observed`, the event the file tools emit after a write or edit lands. Its actor is the tool execution, which carries the tool's name and the agent, so the listener can tell an agent's write from a read and from a write no agent made. The stamp runs after the tool returns, checks the file is still at the version the tool left, replaces the file through a sibling temporary file, and re-emits `fs/observed` with the new version for the same actor, so the observation policy accepts that chat's next edit.

**Mark as checked.** The Files pane posts to a `@idealize/ui-bar` route that confines the path to a documentation folder and calls `ctx.docPolicy.markChecked`. The actor is `human:user`.

**Search.** The FTS5 table stores `type`, `status`, `description` and the parsed `stale_after` instant as unindexed columns. The query orders by a retired-or-stale flag first and FTS5 rank second, comparing `stale_after` with the instant of the search.

**Search by words.** `docs_search` takes an optional `match`: `phrase` (the default, unchanged), `all` or `any`. In the two word modes each word is quoted on its own and the quoted words are joined with `AND` or `OR`, so the caller's text never reaches FTS5 as syntax. An agent no longer has to guess a note's exact wording.

## Alternatives considered

**A wrapping filesystem provider as the hook.** `ctx.fs.writeText` receives no actor, so a wrapper cannot tell an agent's write from the user's and cannot name the brain or model.

**A `tools/execute` wrapper.** It sees the tool call and its agent, but it would have to resolve the tool's path argument a second time and track each tool's argument names. `fs/observed` already carries the resolved target, and `@deepseek-ai/dsh-skill-filesystem` already uses it to notice mutations.

**Prepending a pass-through listener to `fs/write-intent`.** It names writes exactly, but the slot is documented as single-decider, and it fires before the write, so a failed write would still need filtering.

**Writing the stamp through `ctx.fs.writeText`.** The sandboxed backend falls back to the deployment policy for a call with no per-call policy, and the documentation folder usually sits outside the chat's workspace, so the stamp would be refused where the agent's own approved write was allowed. The host writes the stamp directly, as it writes the session log.

**Passing the query to FTS5 unquoted for the word modes.** It would also give prefix and `NEAR` search, but a stray quote or operator in an agent's query then raises a syntax error or changes the meaning of the search.

**A YAML library for the fields.** Reading needs four shapes, and writing has to keep every other byte of the user's note, which a parse-and-serialise round trip does not. `@idealize/doc-policy` also ships to the desktop app as a vendored tarball, where a new runtime dependency costs a resolution entry.

**Asking the model to write `generated`.** The scope rules it out: the record must not depend on a model remembering.

## Consequences

- A stamped note differs from the tool result the model saw by one frontmatter line until the model reads it again.
- `@idealize/doc-policy` depends on `@deepseek-ai/dsh-fs` for the event's types.
- A note an agent writes through the shell is not stamped.
- An archived project's `_index.md` ranks below current notes in search, because `archived` is one of the two retiring statuses.
- The pin names a commit of the canonical repository that must be pushed before the app ships; the generator's sha check is the reviewer's, since the package cannot reach the network.

## Verification

- `packages/idealize/doc-policy/tests/trust.spec.ts`: the reader, the checks and both writers, including byte-order marks and Windows line endings.
- `packages/idealize/doc-policy/tests/stamp.spec.ts`: the stamp over the real file tools, local filesystem and observation policy; the exclusions; a write no agent made.
- `packages/idealize/doc-policy/tests/scan.spec.ts`, `search.spec.ts`, `composition.spec.ts`: the two findings, the rescan when a note expires, ranking and the rendered tool result.
- `packages/idealize/ui-bar/tests/aliases.client.spec.ts`, `files-panel.client.spec.tsx`: the route's fence and the menu item.
