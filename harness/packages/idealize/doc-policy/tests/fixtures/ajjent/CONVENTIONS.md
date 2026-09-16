# Conventions

The operating manual. `CLAUDE.md` is the short version that stays in context;
this is the reference.

## Structure

```
Projects/<Name>/_index.md    The project's map. One per project, always present.
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
repo: ~/code/short-name      # absolute or ~ path to the repository, if there is one
live: https://example.com    # deployed URL, if there is one
created: 2026-01-15
last_touched: 2026-01-15     # ISO date; the session-close hook maintains this
tags: []
---
```

`repo:` is the single most important field. It is what lets the agent verify a
claim instead of believing it, and it is what the session-close hook matches on.
Without it a project is unverifiable, which is the normal state for client work
that produces no code — and worth knowing about explicitly.

### Everything else

```yaml
---
project: short-name          # which project this belongs to, if any
type: note                   # note | decision | reference | person | meeting
created: 2026-01-15
tags: []
---
```

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
