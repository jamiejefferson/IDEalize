# Agent Note: The inherited Chinese corpus and its translation tooling are removed

Status: implemented

## Problem

The [English-only decision](2026-09-01-english-only-docs.md) retired the pairing gate but left 2198 inherited files in place: every `*.zh.md` counterpart and every `*.i18n.yaml` pairing record, plus the tooling that existed only to maintain them (`scripts/*translation*`, the `dsh-translate-docs` skill, `docs/i18n/`, the pairing jobs in `lefthook.yml`, the `dsh-translation-pairing` merge driver, the `translation-prompt` gate). Nothing read them, they drifted from their English sides on every edit, the website still projected them as its root locale, and they would ship with the deployment.

## Decision

JJ (16 Sep 2026): "all non-functional files within this corpus should be removed for the deployment. plugins etc should be kept." Every tracked `*.zh.md` and `*.i18n.yaml` file is deleted, the translation tooling and `docs/i18n/` with them, and each script that read the pair convention is reduced to its English path. Plugin code, including the `zh` entries in plugin locale dictionaries, is untouched.

- The website projects one English locale: `website/docs.ts` lists each page once, `website/.vitepress/config.ts` declares no `locales`, and `scripts/project-doc-site.ts` no longer routes a language switcher.
- The language-switcher line (`English | [中文](foo.zh.md)`) is removed from every Markdown file outside `.agents/notes/`. Notes are historical records and stay as written, so `verify-md-links` skips link targets ending in `.zh.md` or `.i18n.yaml` and no longer scans sources under `.agents/notes/`.
- Archived Agent Notes are single `.md` files. `scripts/archived-agent-notes.ts` validates lines 1-5 of the header; the sealed notes keep their line-6 switcher under the manifest hash. `.agents/notes/archived/manifest.json` is frozen and still lists the deleted Chinese siblings, so `scripts/verify-archived-agent-notes.ts` filters those paths out of both the sealed and the baseline manifest before comparing; the next `--write` drops them.
- `doc-typecheck` and `verify-type-equiv` check every block directly; the byte-identical-derivative partition is gone.
- `gen-cordis-catalog` writes each subsystem region into one page and records nothing.

## Alternatives considered

- **Keep the corpus and only drop the tooling**: rejected by JJ, the files are non-functional and would ship.
- **Keep the archived `.zh.md` and `.i18n.yaml` files as frozen history**: the decision covers the whole corpus; the English half keeps the history.
- **Keep two website locales projecting English**: the site would offer a "简体中文" switch to English content.
- **Strip the switcher lines from the notes too**: the notes are records of their time, and the pre-commit hook refuses staged changes under `archived/`.

## Consequences

- `doc-sync` runs 26 gates; the `translation-prompt` row is gone.
- Links inside `.agents/notes/` are no longer checked; a new note must be proofread by hand.
- An upstream sync re-introduces the corpus as added files; re-apply this removal after the sync.
