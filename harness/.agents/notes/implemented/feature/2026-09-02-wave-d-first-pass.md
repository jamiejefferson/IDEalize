# Agent Note: Wave D first pass — mini mode is the Askbar, Terminal chats close, URL-and-key providers

Status: implemented

JJ's 2 Sep review of landing 4 (nine items; plan `.idealize/plans/feedback-wave-d-plan.md`). This pass ships items 1, 3, 4, 5, 6, 7 and 9 across both repos; items 2 and 8 wait on JJ's answers to the plan's two open questions.

## Problem

Two window designs coexisted: A1's always-visible Askbar and the pre-Askbar `mini` main-window mode, so "minimise" restarted the app into the old slim window while the bar broke under it. The Terminal brain step printed the chat model, but the shell launches a CLI chosen per brain, so the step promised gpt and Claude Code opened. A Terminal chat never sends a prompt, so the sidebar never counted it as started: no row when not current, no menu, no way to close it. The custom-provider card asked six things before Create enabled. The Brains icon read as a shield at 16px; the Askbar's faces were 10px regular on a 45%-dimmed chip; the Gallery repeated its own name above the grid.

## Decision

- **Mini mode is the Askbar** (desktop shell + `@idealize/ui-bar`). The bar mounts hidden; `collapseToBar()` shows it and hides the main window, `expandFromBar()` the reverse; ⌃⌥A, the tray item and the sidebar button all run the transform, never a restart. The `mini` shell mode, `MiniFrame`, `mini-dock`, its settings and proofs are deleted; a stored `mode: mini` still validates and reads as `compatibility` with one warning. `POST /idealize/bar/minimode` calls `desktopActions.collapseToBar()`.
- **Terminal brain step names the CLI.** `LauncherSpaces.terminalLaunches` reads `GET /idealize/terminal/launches`; each Terminal row shows its brain's CLI label (override or default, through the catalogue; `''` = "Plain shell"), a missing executable is stated, and the chat-model key gate does not apply there.
- **A Terminal chat is started from its launch.** `@deepseek-ai/dsh-client-ui-workspace`'s tree treats `blank && space === 'terminal'` as started (`shellOnly`), so the row lists and carries rename/fork/archive; `@idealize/ui-terminal` watches `workspaces.list.archivedSessionIds` and ends an archived chat's shell (`closeTerminal`).
- **Custom provider: URL and key first.** Route id derives from the host (`routeFromUrl`), display name from the id, protocol from the adapter's first; the model list is discovered 600ms after URL and key settle and adopted whole. Id, name, protocol and the manual model editor sit under "More options".
- Brain icon redrawn (lobed outline, fissure, one fold per side); chip faces 11px/700 with dark inks and 0.8 dimming; the Gallery's in-view heading and count removed.

## Alternatives considered

- Keeping both windows and fixing the bar's boot in mini mode: two projections of one idea, and JJ's report was that the second window itself is the defect.
- Making Terminal chats non-blank on the host at launch: the blank flag is the host's prompt-accepted fact; the sidebar's "started" rule is the presentation the user sees, so it changes there.
- Auto-creating the provider once discovery succeeds: Create stays a click, so a wrong URL never writes a profile.

## Consequences

- `DesktopSettings` no longer carries `miniDockSide`/`miniAlwaysOnTop`; `askbarSide` is the one edge setting. `verify:askbar-transform` replaces the three mini proofs.
- The workspace tree's `SessionNode` gains `shellOnly`; the sidebar titles such a row "Terminal".
- The custom-provider card's field order changed; the provider-form spec asserts URL, key, then the More-options fields.
