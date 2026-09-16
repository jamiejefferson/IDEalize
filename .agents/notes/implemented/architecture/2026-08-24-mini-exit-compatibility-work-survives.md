# Agent Note: Mini exit lands in compatibility and work survives the restart

Status: implemented

English | [中文](2026-08-24-mini-exit-compatibility-work-survives.zh.md)

## Problem

Exiting mini mode landed on `advanced` on macOS and Windows — a frame that declares no rail and no drawer, so the tools vanished (JJ round-3: "minimode cannot re-start the app, users will lose their work!"). The mode change is applied by a full Electron relaunch, and two kinds of work did not survive it: the renderer's selected session (persisted in localStorage `dsh.sessions.current`, which dies with the loopback origin because the Web port is random per launch), and every embedded terminal's shell (node-pty processes owned by the exiting main process).

## Decision

**Exit-mini lands on `compatibility` on every platform.** `modeToggleTarget` (electron-shell-generation.ts) fixes the ⌃⌥M target; the vendored `@idealize/ui-bar` minimode route (the expand button's path) is corrected through the repository's yarn `patch:` mechanism (`patches/idealize-ui-bar@1.0.0-dev.0.patch`). Advanced stays reachable through the tray menu's mode radios only. The next vendor sync must carry the route fix into the harness's `packages/idealize/ui-bar` source, or the patch fails loudly against the new tgz.

**The session survives through Host-owned view state.** The main process persists `{ sessionId }` at `view-state/view-state.json` under user data (view-state.ts, same pattern as the pre-mini window frame). The desktop-shell plugin serves it on `GET/POST /_dsh/desktop/view-state` (origin-fenced like the renderer boot route), and the client half (client/session-restore.ts, installed in every desktop mode) records each selection change and re-opens the recorded session once the next generation's session list carries it — never overriding a selection the user or the runtime's own restore already made. localStorage cannot do this job: the loopback port changes each launch, so the origin-keyed storage starts empty.

**Live terminals get V0's restart courtesy.** PTYs die with the relaunch — they live in the exiting main process. The desktop-shell settings watcher now asks (`DesktopRuntime.confirmDiscardTerminals`, an Electron dialog on the shell window) before applying a mode change while any embedded terminal's shell is live; declining rewrites the persisted mode back. Gating at the watcher covers every entry point — tray radios, ⌃⌥M, and the bar route — because all of them persist the mode through the same settings scope.

**The restart stays.** Re-examined for mini→compatibility specifically: profile composition disables the upstream `ui-layout` row for mini but not for compatibility (profile.ts), and the composed row set feeds `boot()` once per process (main.ts), so the served client plugin graph differs between the modes and only a recomposition — the relaunch — can flip it. Regenerating the window alone cannot. The protections above are the answer, and the pre-mini frame restore continues to carry the window geometry.

**Proof:** `scripts/mini-exit-proof.mjs` (`verify:mini-exit`) boots the full profile twice against one temp home: in mini it creates a chat through the real sidebar control, watches the Host record the view state, proves a declined terminal-confirm reverts the mode, presses the expand button and asserts the persisted mode lands on `compatibility` with a restart request; the second boot asserts the compatibility composition, the upstream frame with the rail, and the same session selected again. PNGs and a JSON report land in `.idealize/proof/`.

## Alternatives considered

- **Stabilizing the Web port so localStorage survives.** Rejected: the port row fails loud on a taken port, so reusing the previous random port trades a silent restore loss for a startup failure; the Host-owned file has neither problem.
- **Keeping PTYs alive across the mode change.** Rejected: the shells are children of the exiting main process; keeping them would need an out-of-process terminal host, far beyond this fix. The confirm dialog is the honest alternative.
- **Gating the terminal confirm inside `requestModeChange`.** Rejected: the bar's minimode route writes the settings namespace directly and would bypass it; the settings watcher is the single choke point.
