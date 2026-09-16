# Agent Note: Askbar A1 — the prototype surface and the two-window transform

Status: implemented

Slice A1 of the Askbar/Studio release plan (`.idealize/plans/askbar-plan.md`), built to the design spec (`idealize-askbar-design-spec.md`, JJ's vault, 1 Sep 2026). One new package here (`@idealize/askbar`) plus the desktop repo's Askbar window class; the desktop half's details live in that repo's history.

## Problem

Mini mode reshapes the one BrowserWindow and restarts the whole app to do it (`applies: 'restart'` on the desktop settings namespace), so switching loses layout and reads as a restart — the exact failure the design spec bans. A1 needs a pinned screen-edge dock rendering live agent chips from what the repo already records, and a maxi/mini transform that provably keeps context.

## Decision

**Two long-lived windows over one host, never a mode restart.** The desktop repo gains an `AskbarWindow` (frameless, always-on-top 'floating', 72px, visible over full-screen Spaces on macOS), mounted beside the main window at launch and alive for the app's lifetime. The transform is window visibility: collapse remembers the main window's frame, glides it to the bar's column (`setBounds(..., animate)` — macOS animates, elsewhere it moves instantly) and hides it; expand shows it on the remembered frame. Sessions, drafts and layout never tear down because nothing is re-created. `desktopActions` gains `collapseToBar`/`expandFromBar`; ⌃⌥A is a **global** shortcut (Electron `globalShortcut`, new to the repo) because the window-scoped `before-input-event` chord only fires focused, which is useless for a bar summoned from anywhere. Mini mode itself is untouched until A1 sign-off retires it.

**The bar wins the root slot by priority, not by composition.** The desktop repo's mini/advanced shells stand down upstream ui-layout by disabling its composition row — an app-wide act that cannot serve a second window sharing the composition. Instead `@idealize/askbar`'s client half gates on the window's `dsh-desktop-mode=askbar` URL marker and registers the `root` slot at priority -1 (single slots render their lowest-priority registrant — the same shadowing the hero-launcher fork row uses). In the Askbar window the bar replaces the app frame; every other window never sees a registration. This deleted a planned `askbar.root` child-slot indirection and a desktop-side shell file outright.

**The roster is one honest join, folded host-side.** `GET /idealize/askbar/roster?project=` joins comm's `list` (identity, running, unread, status) with the project board's blockers and the Studio fold's displayed task, through the pure `assembleChips` + `chipStateOf` (the design spec's six states with its precedence order: disconnected, wrong, needs-input, working, ready; listening stays client-local). Both sources are probed, so the roster degrades to comm-only states without studio and to an empty list without comm — the bar renders "unknown" nowhere because A1's presence (a live root agent) is exactly what `running` and studio's `presenceOf` both answer. Interaction timings ride in the same payload as validated config fields (`pendingSendMs` 1000 is JJ's decided value, not a proposal).

**Portraits are computed, not stored.** `portraitOf(project, name)` — kaomoji Option A, decided 1 Sep — is an FNV-1a seed picking eyes, mouth, bracket and a pastel fill, exported from the package root so Studio surfaces and notifications later render the same identity without an asset store.

**The A5 gesture ships without audio.** Hold shows Listening (pulse ring), release runs the one-second progress countdown, Esc discards, and completion opens the panel stating that voice capture arrives in A5 — JJ signs off the gesture's feel against real mechanics, and nothing pretends to record. The panel's ask field dispatches through comm's existing `send`, so the prototype is useful before A4's typed binding exists.

## Alternatives considered

- **A second `ElectronShellGeneration`** for the bar: rejected — the generation owns tray, zoom, mini-dock and navigation-fence concerns the bar has no use for; a dedicated ~120-line owner is smaller than the conditionals.
- **Serving a separate composition to the bar window** (disable ui-layout per window): the loader composes per app, not per window; a per-window composition service is real machinery for a problem priority already solves.
- **Reusing ⌃⌥M** for the transform: it is mini mode's live toggle during the co-existence window; a colliding global registration would shadow the window-scoped handler and change existing behaviour silently.

## Consequences

- The desktop repo's runtime spec now models two window populations; its electron mock tracks the frameless window separately so app-window assertions keep their indices.
- Deferred, tracked in the package README: the hover destination card (`hoverRevealMs` is served, unused), live project-follow after a switch, the Studio group chat (A3) behind the bar's expand actions, voice (A5), and the ⌃⌥A accelerator as a desktop setting.
- Mini mode's retirement (`MiniFrame.tsx`, `mini-shell.ts`, the minimode route) is an A1 sign-off decision, not part of this change.
