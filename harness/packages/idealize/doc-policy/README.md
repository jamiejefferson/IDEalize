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
- **Scan** — on init, on settings change, after vault appends commit evidence, and throttled on `session/flush` (detached from the flush, which is the durability barrier a turn's first step waits on; awaited at disposal), the folder is scanned against the canonical structure. Each scan records its findings and the applied `policyVersion` to the `idealize_docs` storage domain (table `scans`, last 20 kept) when the storage-domain form is composed.
- **Index + `docs_search` tool** — every scan rebuilds an in-memory SQLite FTS5 index over the folder's Markdown (derived data, rebuilt at startup); the `docs_search` tool queries it.
- **Session-start context** — the vault conventions plus the matching project's `_index.md` are injected as model-facing context at `agent/session-start` (moved here from `@idealize/vault`).
- **State route** — `GET /idealize/docs/state` (loopback only) reports the configured folder and last scan for the settings surface. No structural moves happen automatically; findings are reported for agent-proposed edits only.

## Model Experience

### The `docs_search` tool

#### What the model sees

One tool schema, `docs_search`, with parameters `query` (string, required, "Words to find, matched as one literal phrase.") and `limit` (integer, "Maximum documents to return (1-25). Defaults to 8."). Its description reads: `Search the user's documentation folder (their project vault: project index notes, decisions, traps, reference material, people). Full-text match — the query is treated as one literal phrase. Returns matching documents with their vault path, kind, title, and a snippet; read the file at the returned path for the full note. Use it to recall project state, past decisions, and reference material before asking the user or re-deriving an answer.` The result renders one line per hit, `<vault path> — <snippet>`, or the note `No documentation folder is configured yet.` / `No documents matched.` / `No matching documentation.`. The tool is absent from `docs/tool-catalog.md`: the generator globs `packages/*/tool-*`, and this tool ships from an `@idealize` package.

#### Token effect

Fixed schema cost per request wherever the tool is registered. Each call returns at most `limit` lines, each carrying one snippet around the first match.

#### KV Cache effect

Prefix-stable: the schema text is constant. Results are append-only tool output after the reusable prefix.

### Session-start documentation context

#### What the model sees

One plugin-sourced user message (`plugin: 'idealize-doc-policy'`, form `notice`) on `agent/session-start`, present only when a documentation folder is configured, the chat's `cwd` is inside a git repository, and the vault holds a project note for that repository. It opens `Documentation context for this project (the canonical conventions, then the project's _index note at <path> — update it as work lands):`, then the canonical conventions text clipped at 2,000 characters, a `---` separator, and the project's `_index.md` clipped at 6,000 characters; a clip appends `… (clipped)`.

#### Token effect

Conditional and capped: at most about 8,000 characters once per session, nothing for a chat outside a known project.

#### KV Cache effect

Append-only: the notice sits after the system prompt on the first turn and is never rewritten within the session. A later edit of `_index.md` reaches only sessions started afterwards.

## Known Limitations and Deferred Work

- **No filesystem watcher.** External edits to the documentation folder are picked up by the next scan trigger, not immediately.
- **Body-level maintenance rules are not detected.** Append-only decision edits and relative-date prose pass the scanner; the policy module carries the constants for a later pass.
- **`docs_search` has no anchored tool-catalog section.** The catalog generator globs `packages/*/tool-*`, so the schema above is quoted here instead of linked.
