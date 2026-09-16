# Agent Note: Welcome Terminal launches the in-app terminal

Status: implemented

## Problem

The welcome card's Terminal pill POSTed `/idealize/bar/terminal`, which asks the desktop shell to open an EXTERNAL native terminal window (JJ's review: the pill must open the embedded in-app terminal in the main area, shell already in the project folder). Two gaps blocked the in-app route. The pill's visibility rode `/idealize/bar/capabilities` (the desktopActions probe) while the embedded terminal view gates on `/idealize/terminal/capabilities`, so the pill and the view could disagree. And a blank session rendered no view at all: `ConversationSession` returned null whenever `blank && composerPhase === 'blank'`, so writing `view: 'terminal'` into the chat store showed nothing.

## Decision

**ui-terminal owns the launch as a `terminalMode` service.** The client half memoizes one `probeCapabilities()` promise and feeds it to both the ring registration and a new `ctx.provide('terminalMode', ...)` face: `embedded()` returns the probe answer, `open(sessionId)` runs `openTerminalView`. The welcome pill and the view it opens therefore share one gate by construction.

**The view switch writes through the framework's store-instance cache.** `openTerminalView` finds the chat entry on `conversation.view`, then resolves its per-session store instance via the SlotRegistry's renderer host face (`hostFace().storeOf(entry, sessionId)`) and calls `actions.setView('terminal')`. `hostFace` is TS-private; the erased call is deliberate — `handle.create(sessionId)` would mint a parallel instance the rendered ring never reads (the engine caches one instance per handle × scope key inside the registry only). If upstream ever exposes a public per-session store resolver, this is the line to move onto it.

**ui-bar consumes the service optionally.** `ctx.get('terminalMode')` with a restated `TerminalModeLike` face (no value or type import across client bundles); absent service or a false probe hides the Terminal segment exactly as before. The pill click passes the launched session's id; `/idealize/bar/terminal` (the external window) stays for its other callers.

**A blank chat may render a non-chat view.** `ConversationSession` keeps the null render only for the Chat view; any other active view renders full-height with `data-blank-view` on the view area, the header keeps its chrome (the ring tabs are the way back to Chat — flipping back restores the hero), and `ConversationRoot.module.css` uses `:has(.viewArea[data-blank-view])` to retire the hero composer without touching `ConversationRoot.tsx` (the root has no chat-store binding, and adding one to a session-maybe slot would make the `useStore` hook appear mid-life, breaking hook order).

## Alternatives considered

**Advancing `composerPhase` on the terminal launch.** Rejected: the phase derivation is the single authoritative predicate over real conversation content; faking it would mark an untouched chat non-blank.

**Publishing the bound `setView` from the mounted `ModeShortcut`.** Rejected: the header actions seat does not render while the hero owns a blank chat, so the handle would be missing exactly when the welcome pill needs it.

**A `store: chatStore` binding on the root `conversation` registration.** Rejected: the slot is session-maybe; the framework omits `useStore` while no session exists, so the hook count would change when the first session lands.

## Consequences

⌘J behaviour is unchanged (the shortcut still mounts only with the header chrome; on a blank chat's terminal view the header now shows, so ⌘J also leads back to Chat). The chat store's persisted `view` means a session closed on the terminal reopens there once started — pre-existing behaviour, now reachable from blank sessions too. In a plain browser the segment hides because the service probe answers false (or the plugin is absent).
