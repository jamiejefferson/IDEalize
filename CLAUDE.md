# IDEalize

Native macOS multi-terminal app (SwiftUI + AppKit + SwiftTerm), a Claude-Code-native take on Warp, with cross-terminal IPC for coding agents.

## Coordination lives in the vault

Status, thinking and next actions for this project live in your Obsidian vault:
`<your-obsidian-vault>/Projects/IDEalize/_index.md`

Read `<your-obsidian-vault>/VAULT-INDEX.md` for the writing and frontmatter conventions. Update that `_index.md` (Status, Open threads, Next actions, `last_touched`) on session close. This repo is the source of truth for code; the vault is the source of truth for status and thinking.

Note: `Feedback Inbox.md` lives in the vault folder (it is an app-synced note, not code).

## Infra state (Supabase + Vercel)

The live website retired the Supabase email-code download gate (website repo PR #3); distribution is GitHub Releases + `install.sh`. Remaining infra work: deploy `website/vercel.json` security headers (after merging the website repo's `origin/main` — the local website checkout is 9 commits behind), and decide whether to tear down the now-unused Supabase gate functions. The hardened gate code in `supabase/` is undeployed and only needed if the gate returns. Full runbook: [`docs/deploy-web.md`](docs/deploy-web.md). Note: `website/` is its own git repo.
