# Conventions

The operating manual. `CLAUDE.md` is the short version that stays in context;
this is the reference.

## Structure

```
Projects/<Name>/_index.md    The project's map. One per project, always present.
Projects/<Name>/log.md       The project's session log. Tools write it; see below.
Projects/<Name>/*.md         Supporting notes, linked from the index.
Decisions/YYYY-MM-DD-*.md    Cross-project decisions.
Reference/                   Durable material not scoped to one project.
People/<name>.md             Who they are, what they care about, how to reach them.
```

A project folder without an `_index.md` is invisible to every script here. The
index is the contract.

## Frontmatter

Every note carries YAML frontmatter. Scripts read it, so the field names are
fixed. Adding fields is fine; renaming these is not, without updating `scripts/`.

### Project index

```yaml
---
project: short-name          # canonical short name, stable over the project's life
status: active               # active | draft | parked | blocked | done | archived
type: index
description: One line on what this project is   # optional; lists and search results show it
repo: ~/code/short-name      # absolute or ~ path to the repository, if there is one
live: https://example.com    # deployed URL, if there is one
created: 2026-01-15
last_touched: 2026-01-15     # ISO date; "Who writes last_touched" below names the writer
tags: []
---
```

`repo:` is the single most important field. It is what lets the agent verify a
claim instead of believing it, and it is what the session-close hook matches on.
Without it a project is unverifiable, which is the normal state for client work
that produces no code — and worth knowing about explicitly.

### Who writes `last_touched`

IDEalize writes `last_touched` on project notes that carry `repo:`, from commit evidence. On vault-only projects (no `repo:`), the session that did the work sets it at session close, and the weekly review may set it.

Where IDEalize is not installed, `scripts/session-close.py` does the same job on
project notes that carry `repo:`. On those notes the date moves only when there
are new commits, so agents and people leave it alone.

### Everything else

```yaml
---
project: short-name          # which project this belongs to, if any
type: note                   # the writer chooses; see "Type and status belong to the writer"
created: 2026-01-15
tags: []
---
```

### Type and status belong to the writer

The writer of a note chooses its `type`. `note`, `decision`, `reference`, `person`
and `meeting` are common values, and the list is open: a vault that tracks
property listings can use `type: listing`. Tools accept a value they don't
recognise and keep it as written. A tool that rewrites `listing` to `note` throws
away a distinction the writer made on purpose.

The closed `status` list applies to a project `_index.md` only, because scripts
read it there. Any other note can carry any `status` its writer finds useful, such
as `shortlist` or `closed-not-pursuing`, and tools keep it as written.

### Optional fields on any note

Every note, the project index included, can carry these fields. All are optional,
and a note without them stays valid. The names and value formats follow the Open
Knowledge Format, version 0.2.

```yaml
description: One sentence on what this note holds.
generated: { by: idealize/build/model-name, at: 2026-01-15T10:30:00Z }
verified:
  - { by: human:alex, at: 2026-01-16T09:00:00Z }
stale_after: 2026-07-15T00:00:00Z
sources:
  - { id: spec, resource: https://example.com/spec, title: The spec }
```

- `description` is one sentence. Lists and search results show it, so a reader can
  choose a note without opening it.
- `generated` records who produced the current content (`by`) and when it last
  changed (`at`).
- `verified` lists who has checked the content, each with `by` and `at`. One check
  can be written as a single `{ by, at }` mapping. A note with no `verified` is
  unverified, and a `human:` entry means a person reviewed it.
- `stale_after` is the instant the content expires. From then on tools flag the
  note and rank it below current notes.
- `sources` lists what the note derives from. Each entry needs `resource`: a URL,
  a path, or a plain description of the material.

Every date-time in these fields is ISO 8601 with a UTC offset, such as
`2026-01-15T10:30:00Z`. The date-only form stays for `created` and `last_touched`.

A `by` value names an actor in one of three forms: `human:<id>` for a person,
`process:<id>` for an automated job, and `<producer>/<version>` for an agent or
tool, such as `idealize/build/model-name`.

## The session log

Each project keeps its session log in `log.md`, beside `_index.md`. The log
records commit evidence, so the index stays short enough to read whole.

```markdown
---
project: short-name
type: log
created: 2026-01-15
---
# short-name log

## 2026-01-15
- `a1b2c3d` Fix the login redirect
```

The log has one `## YYYY-MM-DD` heading per day and one bullet per commit, with
the short hash first. Tools write it and dedupe on the short hash, so a line added
by hand sits beside a duplicate after the next run. An index written before this
convention can still carry a `## Session log` section. Tools read that section for
hashes they have already logged, and they move it only when the user asks.

## Status, and why it must be allowed to be wrong

`status` is only useful if it can be false. A vault where everything says `active`
carries no information at all.

`/vault-review` therefore challenges it: any project marked `active` with no update
in 30 days gets raised for confirmation or reclassification. Answering "yes, still
active" is a real answer and takes two seconds. Never silently reclassify a project
on the user's behalf.

## Decisions

Decisions are append-only, inside the project index under `## Decisions` for
project-scoped ones, or in `Decisions/` when they span projects.

```markdown
### 2026-03-04 — Use db:push rather than migrations
Chose to skip the migration layer while the schema is still moving weekly.
Accepted cost: no rollback path, so production changes need a manual backup first.
Revisit when the schema settles or a second developer joins.
```

To reverse a decision, add a new entry. Say what changed, and name the entry it
supersedes by date. Do not edit the original — the fact that you believed
something on a given date, and why, is the part worth keeping.

## Traps

A trap is anything that will cost someone an hour because it is not discoverable
from the code. They go under `## Traps` in the project index, and they earn their
place by being non-obvious.

```markdown
## Traps
- ⚠️ `2.0.0` in the changelog looks newer than `0.1.x`, but its source was never
  committed. The `archive/v2-*` branches are the 0.1.x line, not the lost source.
- Deploys only work from the canonical repo; the copy under `website/` is stale.
```

Good traps are specific and falsifiable. "Be careful with the build" is not a trap.

## Links

`[[Wikilinks]]` by note title. They are plain text, so they cost nothing and work
in any tool. Link liberally, including to notes that don't exist yet — an unresolved
link marks something worth writing rather than an error.

## Dates

ISO 8601 (`2026-01-15`), always absolute. A note saying "fixed last Tuesday" is
useless six months later and actively misleading to an agent trying to date events.

## What not to write down

- Anything reconstructible from git. Point at the repo instead.
- Anything a company's own system is authoritative for. Reference it by name.
- Secrets, tokens, keys. Record where the credential lives, never its value.
- Meeting transcripts in full. Record what was decided and what changed.
