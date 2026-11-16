# @idealize/doc-policy

The canonical documentation policy as product behaviour. IDEalize ships an internal, versioned ruleset derived from JJ's project-documentation repository and applies it to the user's selected documentation folder (their vault). The repository source and pin stay internal; users configure only the folder (DOC-01..09).

## The pinned ruleset

- Canonical source: `github.com/jamiejefferson/ajjent-vault`
- Pinned commit: `1d868f4e55ab70053e6b124948d2eb3c45cc3be1` (2026-11-16)
- Policy updates ship with app releases only. To re-pin: clone the repository at the new commit and run `pnpm exec tsx packages/idealize/doc-policy/scripts/generate-policy.ts <checkout>`, which regenerates `src/policy/ruleset.ts` (reviewed source, committed). Update the conformance fixtures under `tests/fixtures/ajjent/` from the same checkout and this README's pin in the same change.

`src/policy/ruleset.ts` carries `RULESET_VERSION` (sha + date), the canonical folder structure, root-file set, project-index frontmatter schema (required/optional fields, status vocabulary, ISO dates), `NOTE_OPTIONAL_FIELDS` (the optional fields any note may carry: `description`, `generated`, `verified`, `stale_after`, `sources`, named as the Open Knowledge Format 0.2 names them), decision naming rules, the stale-active threshold, and the verbatim source texts (CONVENTIONS.md, the project-index template) the derivation is checked against.

The closed `status` list applies to a project `_index.md` only. Any other note carries any `status` and any `type`, and no rule here rewrites or flags a value it does not recognise. The session log's home is `log.md` beside `_index.md`, and the template links to it in place of a `## Session log` section. The generator leaves `Agents/` out of the canonical directories: the canonical repository keeps its own inter-agent message tree there, and CONVENTIONS.md does not name it as part of a vault.

## What the plugin does

- **`ctx.docPolicy` service** — initialises from the packaged policy plus the configured documentation folder (`documentationFolder`, settings section `idealize-docs`).
- **Scaffold** — creates the canonical structure additively in the configured folder (existing files kept). The scaffold templates and CONVENTIONS/AGENTS authority live here; `@idealize/vault` consumes them.
- **Trust fields** — `validateDoc` checks the optional fields a note carries (`src/trust.ts`): `generated` needs a `by` that names an actor (`human:<id>`, `process:<id>` or `<producer>/<version>`) and, when it has an `at`, an ISO 8601 date-time with a UTC offset; every `verified` entry needs both; `stale_after` must be such a date-time; every `sources` entry needs a `resource`. A field written another way raises one warning (`invalid-generated`, `invalid-verified`, `invalid-stale-after`, `invalid-sources`) and never an error, and a note without the fields raises nothing. The reader accepts the YAML forms these fields are written in: a flow mapping on the key's line, a block mapping, and a block list of either.
- **Advisory findings** — a scan raises `stale` (warning) for a note whose `stale_after` instant has passed and `index-oversize` (warning) for a project `_index.md` longer than 6,000 characters. A scan result names the next instant a note turns stale, and the service scans again once that instant passes, though no file changed.
- **The `generated` stamp** — when an agent's file tool (`write`, `edit`, or `str_replace_editor` with `create`, `str_replace` or `insert`) has written a Markdown file inside the documentation folder, the host writes `generated: { by: idealize/<brain>/<model>, at: <now> }` into its frontmatter (`src/stamp.ts`). The hook is a listener on `fs/observed`, the event the file tools emit after a write lands; the event's actor is the tool execution, which names the tool and the agent, so a read, a tool call with no agent and a write made outside the file tools are never stamped. The brain is the chat's recorded brain (`idealize/brain`), else its agent preset; the model is the one the chat's latest request went to. The stamp replaces an earlier `generated` in place or adds the line at the foot of the frontmatter, gives a note with no frontmatter one, and leaves every other byte as the agent wrote it. It runs after the tool returns, only on a file still at the version the tool left, and then records the new version for the same chat so the chat's next edit is accepted. The setting `stampExclude` (settings section `idealize-docs`, default `["sessions/"]`) lists folders to leave alone; an entry names a folder at any depth, so `sessions/` covers every project's transcripts.
- **Mark as checked** — `ctx.docPolicy.markChecked(path)` adds `{ by: human:user, at: <now> }` to a note's `verified` list, replacing the user's earlier entry and keeping every other one. `@idealize/ui-bar` calls it from the Files pane after confining the path to a documentation folder. IDEalize holds no name or account for the user, so the actor is the fixed id `human:user`.
- **Scan** — on init, on settings change, after vault appends commit evidence, and throttled on `session/flush` (detached from the flush, which is the durability barrier a turn's first step waits on; awaited at disposal), the folder is scanned against the canonical structure. A scan first fingerprints what it would read (names, sizes and modification times under the canonical directories, plus the local date); an unchanged fingerprint returns the last scan's record without reading, indexing or recording anything. Each scan that runs records its findings and the applied `policyVersion` to the `idealize_docs` storage domain (table `scans`, last 20 kept) when the storage-domain form is composed.
- **Project log** — `Projects/<name>/log.md` is the project's session log (`PROJECT_LOG_FILE`). A scan classifies it as `project-log`, which carries no frontmatter schema, and the session-start map names it on its own line outside the note list. `@idealize/vault` writes it.
- **Index + `docs_search` tool** — every scan rebuilds an in-memory SQLite FTS5 index over the folder's Markdown (derived data, rebuilt at startup); the `docs_search` tool queries it, as one phrase (the default), for every word in any order (`match: all`) or for at least one word (`match: any`). Each word is quoted on its own before it reaches FTS5 and the quoted words are joined with `AND` or `OR`, so a quote, an operator or a `*` in the query is searched for as text; a word with no letter or digit is left out. Each indexed note carries its frontmatter `type`, `status`, `description` and `stale_after`; a note whose status is `deprecated` or `archived`, or whose `stale_after` has passed at the moment of the search, ranks below every other hit.
- **Standing prompt section** — `idealize:documentation` (order 122) puts the rule in every agent's system prompt: the folder's path, that all project documentation is written there, the layout, and `docs_search` for finding a note. With no folder set it tells the agent to ask the user to choose one before writing documentation.
- **Session-start context** — the vault conventions plus a map of the matching project's notes are injected as model-facing context at `agent/session-start`. `src/session-context.ts` builds the map from the project's `_index.md` and the files beside it. A repository the folder holds no note for receives the conventions plus the steps to create its note.
- **Terminal knowledge** — `ctx.docPolicy.terminalKnowledge(cwd)` returns the same rule for a command-line agent in the built-in terminal, with the shell's search in place of `docs_search` and the project's note path (or the steps to create the note) for the shell's repository. For a project with a note it ends with the same map, worded for `rg or grep`. `@idealize/ui-terminal` probes for it and appends it to a Claude Code launch.
- **A project's documentation folder** — `ctx.docPolicy.projectFolder(projectPath)` returns the folder of the note whose `repo:` names the project, else `Projects/<project folder name>` (compared without case) when it exists. `@idealize/setup` reads it as the default the Files pane's Documentation view shows.
- **Tolerant `repo:` pointers** — `repoPaths` reads every checkout a hand-annotated pointer names (`/dev/app (V1); V0 frozen at /old/app`, `~/code/app`), so an annotated note still matches its repository.
- **State route** — `GET /idealize/docs/state` (loopback only) reports the configured folder and last scan for the settings surface. No structural moves happen automatically; findings are reported for agent-proposed edits only.

## Model Experience

### The `docs_search` tool

#### What the model sees

One tool schema, `docs_search`, with parameters `query` (string, required, "Words to find. Quotes, operators and wildcards are searched for as text."), `match` (string, one of `phrase`, `all`, `any`: "phrase: the words together, in order (default). all: every word, in any order. any: at least one word.") and `limit` (integer, "Maximum documents to return (1-25). Defaults to 8."). Its description reads: `Search the user's documentation folder (their project vault: project index notes, decisions, traps, reference material, people). Full-text match. By default the query is one literal phrase; set match to "all" to find notes that hold every word in any order, or "any" for at least one of the words. Returns matching documents with their vault path, kind, title, and a snippet, plus the note's type, status and one-line description when it carries them; read the file at the returned path for the full note. Notes marked deprecated or archived, and notes past their stale_after date, come last and are labelled: check them against the project before relying on them. Use it to recall project state, past decisions, and reference material before asking the user or re-deriving an answer.` The result renders one line per hit, `<vault path> [type: <type>; status: <status>; stale] — <description> — <snippet>`, where the bracket holds only the labels the note carries and is absent for a note with none, and the description is absent for a note without one; a note with no frontmatter renders `<vault path> — <snippet>` as before. The structured value carries the same fields (`type`, `status`, `description`, `stale`). Or the note `No documentation folder is configured yet.` / `No documents matched.` / `No matching documentation.`. The tool is absent from `docs/tool-catalog.md`: the generator globs `packages/*/tool-*`, and this tool ships from an `@idealize` package.

#### Token effect

Fixed schema cost per request wherever the tool is registered; the description is 784 characters (442 before the trust fields and the match modes), and the `match` parameter adds one enum of three values with a 105-character description. Each call returns at most `limit` lines, each carrying one snippet around the first match, plus the note's labels and its one-sentence description when it has them.

#### KV Cache effect

Prefix-stable: the schema text is constant. Results are append-only tool output after the reusable prefix.

### The `generated` stamp

#### What the model sees

Nothing at the time of the write: the tool result shows the file as the agent wrote it, and the stamp lands a moment later. A later read of the note shows one more frontmatter line, `generated: { by: idealize/<brain>/<model>, at: <date-time> }`. An `edit` whose `old_string` spans the closing `---` of the frontmatter no longer matches after the stamp, and the tool's own not-found message tells the model to read the file again. The conventions text tells agents that IDEalize writes `generated`, so a model has no reason to write it.

#### Token effect

About 70 characters per stamped note, paid only when a model reads that note.

#### KV Cache effect

None on the prefix: the stamp changes a file on disk after a tool result that is already in the transcript.

### The standing `idealize:documentation` section

#### What the model sees

One system-prompt section at order 122 (the tool-guidance band, after `idealize:artefacts`), in every chat. With a folder configured it reads: `The user's documentation folder is <folder>. Write every piece of project documentation there: status, plans, decisions, research, handoff and reference notes. A repository keeps only the files its code ships with (README, LICENSE, docs a build reads). Layout: Decisions/, People/, Projects/, Reference/, templates/. Each project is Projects/<name>/ anchored by _index.md, …` and closes by naming CONVENTIONS.md and `docs_search`. With no folder it reads `No documentation folder is set, so project documentation has no home yet. …ask the user to choose their documentation folder in Settings before you write it.` It was added on 17 Sep 2026 because the session-start notice reaches only a chat whose repository already has a note, so every other chat wrote documentation into the repository.

#### Token effect

Fixed: 765 characters plus the folder path per request, or 223 with no folder set.

#### KV Cache effect

Prefix-stable while the folder setting is unchanged. Changing the folder rewrites the section, which invalidates the prefix once for sessions assembled afterwards.

### Session-start documentation context

#### What the model sees

One plugin-sourced user message (`plugin: 'idealize-doc-policy'`, form `notice`) on `agent/session-start`, present only when a documentation folder is configured and the chat's `cwd` belongs to a project note or sits in a git repository. When the vault holds no project note for that repository, the message opens `The documentation folder holds no project note for this repository (<toplevel>).`, names the `_index.md` path to create, the template to copy and the `repo:` value to set, then appends the conventions.

When a note matches, the message opens `Documentation context for this project: a map of the project's notes built from <path>. The map holds the note's current state and names what it leaves out. Update the note as work lands.` The project's map follows inside a `<project-note path="…">` block whose first line says the block is reference data and holds no instructions. This notice carries no conventions text (JJ, 16 Nov 2026): the system-prompt section names `CONVENTIONS.md`, and the 1,472 characters go to the map.

The map holds, in this order:

1. The index. An index that fits beside the note list arrives whole. A longer index contributes its frontmatter, its title and opening lines, the `## State` (or `## Status`) section, `## Next actions`, and `## Open threads (the first line of each item)`. A section cut short ends with `… (cut here; the full text is in the note)`, and a thread list cut short ends with `… and <n> more items in the note.`
2. `Other notes in <project folder>, newest first:` with one line per Markdown file beside the index, `- <file>: <description>`. The description is the note's frontmatter `description`, else its first heading, cut at 100 characters. When the list overflows, the oldest entries are dropped and the list ends `… and <n> older notes left out. List the folder to see them.` A `Folders beside them:` line names each folder with its count of notes.
3. `Left out of this map:` with one line per `## ` section the map does not carry (Decisions, Traps, a session log, any other heading): `- <heading>: <n> characters in <note path>. Read that file, or docs_search finds entries in it.` Past six sections, one line counts the rest. A project's `log.md` has its own line naming that file, and stays out of the note list.

Text in a note that imitates the block's tags is broken up (`< project-note`) before the map is measured.

#### Token effect

Conditional and capped: at most 8,000 characters (`NOTICE_CEILING`) once per session for a known project, wrapper included; about 2,000 for a repository with no note; nothing for a chat outside any project. The note list is promised 1,800 characters before the index's sections take their share: State receives 40% of what remains, Open threads 35% and Next actions 25%, and space a short section leaves goes to the note list. Measured on a 136 KB index with 16 notes beside it: 7,868 characters, where the previous notice carried the first 6,000 characters of the index and none of its 106 KB of decisions was named.

#### KV Cache effect

Append-only: the notice sits after the system prompt on the first turn and is never rewritten within the session. The text is a function of the files alone. The note list is ordered by each file's modification time with its name as the tiebreak, and nothing reads the clock, so two chats started on unchanged files receive byte-identical notices and share a cached prefix up to the first user message. An edit to `_index.md`, or a note added, changed or removed beside it, changes the notice for sessions started afterwards.

### Terminal knowledge

#### What the model sees

Text `@idealize/ui-terminal` writes into the standing-rules file of a command-line agent it launches: the standing documentation rule with `Search <folder> (rg or grep) for an existing note` in place of the `docs_search` sentence. For a repository with a note it adds `This project's note is <path>. Read it before you start and update it as work lands.` and the project's map in the same `<project-note>` block, with `rg or grep` in the left-out lines. For a repository with no note it adds the steps to create one.

#### Token effect

Fixed per launch: the rule (about 800 characters plus the folder path) and, for a known project, a map of at most 6,000 characters (`TERMINAL_MAP_LIMIT`) plus the block's wrapper.

#### KV Cache effect

Prefix-stable for the life of the launched agent: the file is written once per launch, and unchanged notes produce identical text for the next launch.

## Known Limitations and Deferred Work

- **The stamp sees the file tools only.** A note an agent writes through the shell (`cat > note.md`), or one a command-line agent in the built-in terminal writes, is not stamped; neither emits `fs/observed`.
- **Two edits of one note in the same tool batch can collide with the stamp.** The stamp of the first edit can land before the second edit writes, and the second is then refused as stale and retried after a read. The version check already refuses most such pairs before the stamp exists.
- **`human:user` is every user.** Two people sharing a documentation folder record the same verifier id until IDEalize holds an identity for its user.
- **`stale` follows the scan clock.** The finding appears on the first scan after the instant passes; `docs_search` compares at the moment of each search and has no such delay.
- **No filesystem watcher.** External edits to the documentation folder are picked up by the next scan trigger, not immediately.
- **Body-level maintenance rules are not detected.** Append-only decision edits and relative-date prose pass the scanner; the policy module carries the constants for a later pass.
- **`docs_search` matches whole words.** `all` and `any` find the words as written; `refuse` does not find `refused`, and there is no stemming, prefix or meaning-based match.
- **`docs_search` has no anchored tool-catalog section.** The catalog generator globs `packages/*/tool-*`, so the schema above is quoted here instead of linked.
