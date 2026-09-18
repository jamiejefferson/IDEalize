# @idealize/doc-policy

The canonical documentation policy as product behaviour. IDEalize ships an internal, versioned ruleset derived from JJ's project-documentation repository and applies it to the user's selected documentation folder (their vault). The repository source and pin stay internal; users configure only the folder (DOC-01..09).

## The pinned ruleset

- Canonical source: `github.com/jamiejefferson/ajjent-vault`
- Pinned commit: `9f7cfe992a0fc20a36425fd502a22873cbcf4e3c` (2026-08-12)
- Policy updates ship with app releases only. To re-pin: clone the repository at the new commit and run `pnpm exec tsx packages/idealize/doc-policy/scripts/generate-policy.ts <checkout>`, which regenerates `src/policy/ruleset.ts` (reviewed source, committed). Update the conformance fixtures under `tests/fixtures/ajjent/` from the same checkout and this README's pin in the same change.

`src/policy/ruleset.ts` carries `RULESET_VERSION` (sha + date), the canonical folder structure, root-file set, project-index frontmatter schema (required/optional fields, status vocabulary, ISO dates), decision naming rules, the stale-active threshold, and the verbatim source texts (CONVENTIONS.md, the project-index template) the derivation is checked against.

## What the plugin does

- **`ctx.docPolicy` service** — initialises from the packaged policy plus the configured documentation folder (`documentationFolder`, settings section `idealize-docs`).
- **Scaffold** — creates the canonical structure additively in the configured folder (existing files kept). The scaffold templates and CONVENTIONS/AGENTS authority live here; `@idealize/vault` consumes them.
- **Scan** — on init, on settings change, after vault appends commit evidence, and throttled on `session/flush` (detached from the flush, which is the durability barrier a turn's first step waits on; awaited at disposal), the folder is scanned against the canonical structure. A scan first fingerprints what it would read (names, sizes and modification times under the canonical directories, plus the local date); an unchanged fingerprint returns the last scan's record without reading, indexing or recording anything. Each scan that runs records its findings and the applied `policyVersion` to the `idealize_docs` storage domain (table `scans`, last 20 kept) when the storage-domain form is composed.
- **Index + `docs_search` tool** — every scan rebuilds an in-memory SQLite FTS5 index over the folder's Markdown (derived data, rebuilt at startup); the `docs_search` tool queries it.
- **Standing prompt section** — `idealize:documentation` (order 122) puts the rule in every agent's system prompt: the folder's path, that all project documentation is written there, the layout, and `docs_search` for finding a note. With no folder set it tells the agent to ask the user to choose one before writing documentation.
- **Session-start context** — the vault conventions plus the matching project's `_index.md` are injected as model-facing context at `agent/session-start` (moved here from `@idealize/vault`). A repository the folder holds no note for receives the conventions plus the steps to create its note.
- **Terminal knowledge** — `ctx.docPolicy.terminalKnowledge(cwd)` returns the same rule for a command-line agent in the built-in terminal, with the shell's search in place of `docs_search` and the project's note path (or the steps to create the note) for the shell's repository. `@idealize/ui-terminal` probes for it and appends it to a Claude Code launch.
- **A project's documentation folder** — `ctx.docPolicy.projectFolder(projectPath)` returns the folder of the note whose `repo:` names the project, else `Projects/<project folder name>` (compared without case) when it exists. `@idealize/setup` reads it as the default the Files pane's Documentation view shows.
- **Tolerant `repo:` pointers** — `repoPaths` reads every checkout a hand-annotated pointer names (`/dev/app (V1); V0 frozen at /old/app`, `~/code/app`), so an annotated note still matches its repository.
- **State route** — `GET /idealize/docs/state` (loopback only) reports the configured folder and last scan for the settings surface. No structural moves happen automatically; findings are reported for agent-proposed edits only.

## Model Experience

### The `docs_search` tool

#### What the model sees

One tool schema, `docs_search`, with parameters `query` (string, required, "Words to find, matched as one literal phrase.") and `limit` (integer, "Maximum documents to return (1-25). Defaults to 8."). Its description reads: `Search the user's documentation folder (their project vault: project index notes, decisions, traps, reference material, people). Full-text match — the query is treated as one literal phrase. Returns matching documents with their vault path, kind, title, and a snippet; read the file at the returned path for the full note. Use it to recall project state, past decisions, and reference material before asking the user or re-deriving an answer.` The result renders one line per hit, `<vault path> — <snippet>`, or the note `No documentation folder is configured yet.` / `No documents matched.` / `No matching documentation.`. The tool is absent from `docs/tool-catalog.md`: the generator globs `packages/*/tool-*`, and this tool ships from an `@idealize` package.

#### Token effect

Fixed schema cost per request wherever the tool is registered. Each call returns at most `limit` lines, each carrying one snippet around the first match.

#### KV Cache effect

Prefix-stable: the schema text is constant. Results are append-only tool output after the reusable prefix.

### The standing `idealize:documentation` section

#### What the model sees

One system-prompt section at order 122 (the tool-guidance band, after `idealize:artefacts`), in every chat. With a folder configured it reads: `The user's documentation folder is <folder>. Write every piece of project documentation there: status, plans, decisions, research, handoff and reference notes. A repository keeps only the files its code ships with (README, LICENSE, docs a build reads). Layout: Decisions/, People/, Projects/, Reference/, templates/. Each project is Projects/<name>/ anchored by _index.md, …` and closes by naming CONVENTIONS.md and `docs_search`. With no folder it reads `No documentation folder is set, so project documentation has no home yet. …ask the user to choose their documentation folder in Settings before you write it.` It was added on 17 Sep 2026 because the session-start notice reaches only a chat whose repository already has a note, so every other chat wrote documentation into the repository.

#### Token effect

Fixed: 765 characters plus the folder path per request, or 223 with no folder set.

#### KV Cache effect

Prefix-stable while the folder setting is unchanged. Changing the folder rewrites the section, which invalidates the prefix once for sessions assembled afterwards.

### Session-start documentation context

#### What the model sees

One plugin-sourced user message (`plugin: 'idealize-doc-policy'`, form `notice`) on `agent/session-start`, present only when a documentation folder is configured and the chat's `cwd` is inside a git repository. When the vault holds no project note for that repository, the message opens `The documentation folder holds no project note for this repository (<toplevel>).`, names the `_index.md` path to create, the template to copy and the `repo:` value to set, then appends the conventions clipped at 2,000 characters. When a note matches, it opens `Documentation context for this project (the canonical conventions, then the project's _index note at <path> — update it as work lands):`, then the canonical conventions text clipped at 2,000 characters, a `---` separator, and the project's `_index.md` clipped at 6,000 characters; a clip appends `… (clipped)`.

#### Token effect

Conditional and capped: at most about 8,000 characters once per session for a known project, about 2,500 for a repository with no note, nothing for a chat outside a git repository.

#### KV Cache effect

Append-only: the notice sits after the system prompt on the first turn and is never rewritten within the session. A later edit of `_index.md` reaches only sessions started afterwards.

## Known Limitations and Deferred Work

- **No filesystem watcher.** External edits to the documentation folder are picked up by the next scan trigger, not immediately.
- **Body-level maintenance rules are not detected.** Append-only decision edits and relative-date prose pass the scanner; the policy module carries the constants for a later pass.
- **`docs_search` has no anchored tool-catalog section.** The catalog generator globs `packages/*/tool-*`, so the schema above is quoted here instead of linked.
