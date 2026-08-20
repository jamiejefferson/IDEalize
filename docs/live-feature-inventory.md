# Live feature inventory — V0 (0.10.6, build 25), frozen 2026-08-18

Every user-facing feature of the frozen Swift app, with its behaviour contract and its fate in the V1 rebuild (the DeepSeek Harness fork). Fates: **stock** (DSH provides it), **recreate** (we build it in V1), **v1.x** (recreate after launch), **retire** (dies with V0).

Compiled from README.md, the vault `_index`, `AppSettings`, the UI/Model source list and the CLI reference. **Fate column signed off by JJ 2026-08-18** (documents panel → v1.x, voice dictation → retire confirmed); this is the parity contract for V1.

## Terminal core

| Feature | Behaviour contract | Fate |
|---|---|---|
| Multi-terminal workspace | Tabs + recursive split panes (⌘D/⇧⌘D), per-tab status dot + foreground process name, ⌘W close, ⇧⌘]/[ tab cycling | **Retire** — V1 is chat-first; agents run commands as tools |
| SwiftTerm terminal | Full text input, selection, copy/paste, mouse reporting for TUIs | **Retire** |
| Blocks | Shell integration (zsh via ZDOTDIR, bash via --rcfile) emits OSC 1771 markers; each command tracked as a block with exit status, duration, cwd; Blocks sidebar (⌘B) | **Retire** — the trajectory ledger is V1's answer to "what ran and how it went" |
| Command palette (⌘P) | Fuzzy launcher: actions, themes, workflows, recent commands, open terminals | **Retire** (DSH web client has its own command surface) |
| Command composer (⌘L) | Bottom input bar, ↩ runs, ↑/↓ history | **Retire** |
| Command history | Per-session record, searchable, re-runnable | **Retire** |
| Default launch command / shell path / launch-on-new-terminal | Auto-run a command in new terminals (default OFF since the security overhaul) | **Retire** |
| Terminal themes + appearance | 6 themes, gradient editor, ink filter, computed selection-contrast rule, monospaced font picker, margins, blur, line spacing | **Retire** as terminal features; the *stylability principle* carries into V1's skin/theming (S3) |
| Inline images (Kitty graphics) | `idealize image` renders inline | **Retire** — web UI renders images natively |

## Agent chat layer

| Feature | Behaviour contract | Fate |
|---|---|---|
| Agent chat GUI | Chat pane wrapped around the terminal agent; Claude + Kimi + pi adapters (launch/resume commands, session-id binding, transcript following, busy detection, harness-noise filtering); `agent-hello` handshake for other agents | **Stock** — DSH sessions *are* the agent, no wrapping needed |
| Chat rendering | Markdown, attachment chips, drag/drop + pasteboard image attach, agent questions as tappable option buttons | **Stock** (ui-conversation, ui-attachment, ui-user-questions) |
| Context gauge | Model-aware context usage readout | **Stock** (DSH token metering) — verify in spike |
| Voice dictation | Push-to-talk dictation into the composer, release-to-send option | **Retire**; revisit if missed |
| Archive / rename / restore chats | Chats persist, restore across launches, archived list | **Stock** (DSH session persistence) |
| Session rail | Projects (folder = card) containing chats; bold = unread rolled up to project header; recents | **Stock** (ui-sidebar + workspaces); project grouping conventions carry into S6 |
| Documents panel | Markdown editor beside the chat, editable by default, heading navigation, use-as-context | **v1.x** — check DSH ui-deliverables in the spike; port only what's missing |
| Meeting transcription | Record → on-device FluidAudio/Parakeet transcript drops in on Stop → use-as-context | **Retire** (decided) |
| File explorer / file viewer panels | Browse and view project files in-app | **Stock** — verify coverage in spike |
| Welcome slate, showcase tour, shortcuts help | Owl slate, first-run tour, ⌘/ keybinds sheet | **Recreate** lightly as part of the skin (S3) |
| Done chime + notifications | Native notification + optional completion sound with volume | **Recreate** in wrapper (S9) |

## Coordination

| Feature | Behaviour contract | Fate |
|---|---|---|
| Cross-terminal IPC | `idealize send/broadcast/inbox/peek/list/exec/type/status/focus/whoami/ping/notify/note/transcript/spawn`; token-gated mutating commands; session addressing by id/label/project | **Stock-mostly** — DSH agents share one host (subagents, `agent.inject()`, session events); spike measures the residual gap; any remainder is a small bridge plugin (S11) |
| Project agent | Per-project coordinator chat: `/project-agent` operating prompt, FSEvents conflict nudges, suggestion banner, plain-language escalations | **v1.x** — port the operating prompt onto a DSH agent preset (ui-agent-preset) |
| Lead agent | Fleet tier above project agents: pinned rail card, FleetMonitor, one-line upward status grammar | **v1.x** — same route |
| Agent comms protocol | One canonical wire vocabulary (vault: Agent-Comms-Protocol), mirrored into shipped skills | **v1.x** — carries over with the presets |
| FlowSkills installer | Versioned install of skills/commands into `~/.claude` | **Retire** — V1 skills ship as DSH skill packages (`ui-skill` exists) |
| Claude Code hooks integration | Ready-to-paste hook configs for notify/handoff/images | **Stock** — DSH ships `hooks-claude-code` / `hooks-codex` compatibility |

## Workflows and Flows

| Feature | Behaviour contract | Fate |
|---|---|---|
| Workflows | Saved parameterised commands (`{{param}}` prompts), palette-run, Settings manager | **Retire** (decided) |
| Flows | Plain-language interview → runnable multi-step Flow; library, editor, timeline, version history, pause/resume, runner skills | **Retire** (decided) |

## App level

| Feature | Behaviour contract | Fate |
|---|---|---|
| Mini-mode | Docks to a slim column (side, always-on-top), compact layout under 560px, exact frame restore on exit | **Recreate** as a wrapper window preset (S2) |
| Service hatch | Toggle opens an agent session on the app's own source repo (path in Settings; opens Settings if unset) | **Recreate, refactored** into the Hatch: DSH plugin customisation (S8) |
| Feedback sheet | Type picker + optional screenshot (≤1600px JPEG) → Supabase, insert-only RLS | **Recreate** as a plugin reusing the existing tables (S10) |
| Announcement banner | Supabase-driven in-app announcements, `max_app_version` gating | **Recreate** in the same plugin (S10) |
| Theming/typography preferences | UI font, sizes, chat spacing/opacity, panel appearances, action style | **Recreate** via V1 skin tokens (S3) |
| install.sh + release pipeline | One-line install/update, quarantine clear, anonymous version ping, `scripts/release.sh` | **Recreate** for the wrapper app (S2) |
| Website | idealize.projject.ai, download CTA | **Recreate**: update for V1 at launch |

## V0 disposition

V0 freezes at 0.10.6 (build 25). Backup verified in `_AppDev/ARCHIVE/IDEalize-V0-freeze-2026-08-18/` (repo + website bundles, worktree tar including uncommitted work, release zip). Local `main` preserved as `backup/local-main-2026-08-18`; `origin/main` at tag `v0.10.6` is canonical. No further releases; the final announcement (at V1 launch) marks it the last terminal version.
