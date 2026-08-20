---
name: idealize-feedback
description: Read and triage IDEalize user feedback from Supabase — list items by status, mark them in_progress/shipped/wont_fix, and batch shipped items into a grouped announcement. Use when asked to check, review, triage, or action user feedback.
---

# Read & triage IDEalize feedback

Users submit feedback from the app (the "Feedback" pill), which inserts a row
into `idealize_feedback` in Supabase. This skill is the operator's view: read
what's come in, move items through a small status flow, and batch the fixed ones
into a single grouped announcement.

- **Project id:** `xlswtyprnmiymfjdbaez`
- **Table:** `public.idealize_feedback`
- Requires the **Supabase MCP tools** (`execute_sql`) — service role.

## The status flow

Every row has a `status` and, once shipped, a `shipped_version`:

```
new  →  in_progress  →  shipped
                    ↘  wont_fix
```

| status | meaning |
|---|---|
| `new` | just arrived, untriaged (the app inserts everything as `new`) |
| `in_progress` | picked for the next batch / being worked on |
| `shipped` | fixed and released; `shipped_version` records which build (e.g. `0.1.2`) |
| `wont_fix` | acknowledged, not doing it |

The `status` column has a CHECK constraint — only those four values are valid.

## Reading

Default view — open items first, newest first:

```sql
select id, created_at, status, shipped_version, text
from idealize_feedback
where status in ('new', 'in_progress')
order by created_at desc;
```

Show it back grouped by status, quoting each item's `text` verbatim, with its
short id (first 8 chars is enough to reference). Also note the app_version /
os_version if the user asks who's affected.

## Triage (always confirm the wording/choice with the user first)

- **Pick items for the next batch:**
  ```sql
  update idealize_feedback set status = 'in_progress' where id in ('…','…');
  ```
- **Mark shipped after a release** (stamp the version you actually built):
  ```sql
  update idealize_feedback set status = 'shipped', shipped_version = '0.1.2'
  where id in ('…','…');
  ```
- **Decline:** `update idealize_feedback set status = 'wont_fix' where id = '…';`

## The grouped-update loop (the point of all this)

1. **Collect** — items arrive as `new`.
2. **Triage** — mark the ones going into the next release `in_progress`.
3. **Fix + ship** — build fixes (Conductor + the `idealize-service-hatch` skill),
   run `scripts/build-app.sh`, bump the version in `scripts/build-app.sh`
   (`CFBundleShortVersionString`). Then mark those rows `shipped` + `shipped_version`.
4. **Announce** — read back the rows just shipped for a version and **auto-draft
   the "what's new" list from their text**, e.g.:
   ```sql
   select text from idealize_feedback where shipped_version = '0.1.2' order by created_at;
   ```
   Turn each into a short user-facing bullet, get the user to approve the wording,
   then hand off to the **`idealize-announce`** skill to publish one grouped banner.

This keeps every announcement traceable to the exact feedback it resolved, and
means the "what we fixed" list is generated from real shipped work, not written
by hand. Distribution is direct for now (there are only a couple of users — the
operator sends them the build); the banner is the "here's what changed" note.
