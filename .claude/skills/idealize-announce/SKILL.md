---
name: idealize-announce
description: Push an in-app announcement ("update message") to IDEalize users, or list/deactivate existing ones. Use when the user wants to tell users something — a new release, a shipped fix, a heads-up — inside the app.
---

# Push an announcement to IDEalize users

IDEalize shows a **dismissible banner** under the title bar carrying the latest
active announcement. Each user sees a given announcement **once** (the app
remembers the last-dismissed id). You publish one by inserting a row into the
`idealize_announcements` table in Supabase.

- **Project id:** `xlswtyprnmiymfjdbaez`
- **Table:** `public.idealize_announcements`
- **App UI:** `Sources/IDEalizeApp/UI/AnnouncementBanner.swift`

Publishing requires the **Supabase MCP tools** (`apply_migration` /
`execute_sql`), which run with the service role. Users can only *read* active
rows (via the anon key), so only an operator here can publish.

## Columns

| column | meaning |
|---|---|
| `title` | short bold line (e.g. "IDEalize 0.1.1 is ready") — **required** |
| `body` | one or two sentences of detail — **required** |
| `cta_label` | optional button text (e.g. "Download update") |
| `cta_url` | optional link the button opens (needed if `cta_label` is set) |
| `min_app_version` | optional — only show to this app version or newer (null = no floor) |
| `max_app_version` | optional — only show to this version or **older** (null = no ceiling) |
| `active` | master on/off. Set older ones `false` so only one shows |

**Bootstrap caveat:** the announcement-fetching code shipped *in* 0.1.1, so
only apps on **0.1.1 or newer can ever fetch a banner**. A "please update"
notice aimed at older versions can't reach them (they have no fetch code) — for
those, tell users directly. Announcements aimed at users *on the new version*
("here's what shipped") should set `min_app_version` to that version and leave
`max_app_version` null.

**Version gating for a release notice:** to nag only users who haven't updated,
set `max_app_version` to the version *below* the new release. Once someone is on
the new version the banner disappears for them. Leave both null to show to
everyone. The app reads version from `CFBundleShortVersionString` (set in
`scripts/build-app.sh`); a dev build under `swift run` ignores version gates.

## To publish

1. Confirm the wording with the user: **title**, **body**, and whether there's a
   **CTA button** (label + url) and a **version ceiling**.
2. Deactivate any currently-active announcement first so only the newest shows
   (unless the user wants several):
   ```sql
   update public.idealize_announcements set active = false where active = true;
   ```
3. Insert the new one via `execute_sql` (parameterise the text safely — escape
   single quotes):
   ```sql
   insert into public.idealize_announcements (title, body, cta_label, cta_url, max_app_version)
   values ('IDEalize 0.1.1 is ready',
           'Shift+Enter now inserts a newline, and you can cancel a running prompt. Thanks for the feedback!',
           'Download update', 'https://…', '0.1.0');
   ```
4. Read the row back and show the user what will appear (title / body / button /
   who sees it). It goes live the next time each user launches the app.

## Also handy

- **List:** `select id, created_at, active, title, max_app_version from idealize_announcements order by created_at desc;`
- **Pull one:** set `active = false` on its id.
- This pairs with the feedback loop — after shipping a fix for a feedback item,
  announce it and mark that feedback row `shipped`.
