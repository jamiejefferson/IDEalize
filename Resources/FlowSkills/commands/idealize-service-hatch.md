---
description: Safely service IDEalize's own source from inside the running app — orient, branch, edit, build, verify, and record status in the vault.
---

You are in IDEalize's **service hatch**: a Claude session opened from inside the
running IDEalize app, rooted in its own source tree (`Package.swift`,
`Sources/IDEalizeApp/`), to safely edit the app itself. Treat this as a careful
self-surgery session. Work in short, verifiable steps and keep the user in the loop.

## 1. Orient before touching anything
- Read `CLAUDE.md` at the repo root — it is the ground truth for how this project works.
- Status, thinking, and next actions live in the **vault**, not the repo:
  `~/Documents/_Obsidian Vaults/JacqVault/Projects/IDEalize/_index.md`
  (added to your working dirs). Read it first, and read
  `JacqVault/VAULT-INDEX.md` for the writing/frontmatter conventions.
- Skim recent history: `git status` and `git log --oneline -15`. Note the current branch.

## 2. This session runs *inside the app you're editing* — the golden rule
Rebuilding and **relaunching** IDEalize will close THIS tab and end this session.
Editing the source does **not** affect the already-running instance; only a relaunch
picks up your changes. So:
- **Commit or checkpoint before any relaunch.** This session survives on disk — the
  user can re-open the hatch and you can pick up with `claude --resume`.
- **Never** `pkill IDEalize`, quit, or relaunch the app without first telling the user
  it will close this hatch, and getting a clear go-ahead.

## 3. Work safely
- Don't commit straight to `main`. If you're on `main`, create a branch first
  (`git switch -c <topic>`), matching the existing branch-naming style.
- Keep changes small and focused. Prefer `Edit` over rewrites; match the surrounding
  code's idiom, comment density, and naming.
- Compile early and often with `swift build` — it catches errors in a few seconds
  **without** relaunching the app, so you never need to disturb this session to know
  the code is sound.

## 4. Build & verify
- Quick compile check: `swift build`
- Full signed app bundle (writes `dist/IDEalize.app`): `scripts/build-app.sh --debug`
- To see a change **live**, the app must be relaunched — which closes this hatch.
  When you reach that point, stop and hand it to the user: summarise what to look for,
  and let them quit & reopen (then re-open the hatch to continue). Don't relaunch
  behind their back.
- Verify behaviour, not just that it compiles. Reason through the affected flow; where
  you can, exercise it. Report honestly if something is unverified.

## 5. Wrap up
- Update the vault `_index.md` (Status, Open threads, Next actions, `last_touched`)
  per the conventions in `VAULT-INDEX.md`. The repo is the source of truth for code;
  the vault is the source of truth for status and thinking.
- Give the user a tight summary: what changed, what's built/committed, and what's left.
