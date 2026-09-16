# Agent Note: Fork chat says why it did not fork

Status: implemented

JJ, 8 Sep 2026, on the landing-14 build: "Fork chat doesn't seem to work."

## Problem

The row menu's Fork handler in `@deepseek-ai/dsh-client-ui-workspace` called `ctx.sessions.fork` and discarded every rejection, so a failed fork looked like a dead menu item. The common failure is a chat forked before its first reply: the Host cuts a fork at the source's last `turn/end`, and a chat with a prompt but no completed turn has none, so the Host answers `fork-unavailable` and nothing on screen changed. A second, rarer failure is the child's title increment being refused after the child exists; the handler hid that too, leaving an unexplained new row.

## Decision

**The handler rejects with the words the person reads.** `forkSession` in the browser's injected contract now returns `Promise<void>`. The handler awaits the runtime's fork and maps its two documented failures: a `SessionForkError` (no child exists) with code `fork-unavailable` becomes `fork.unavailable` ("This chat has nothing to fork yet. Fork it after its first reply."), any other `SessionForkError` passes the Host's message through, and a plain `Error` (the runtime's post-creation rename failure) becomes `fork.renameFailed` ("Forked, but the copy kept the original name."). The runtime's client entry exports `SessionForkError` so the handler tells the failures apart by class instead of by message text. **The browser shows the rejection in the shared Toast** (`WorkspaceBrowser.tsx`, the same transient banner the composer and the model picker use), keyed by a per-show sequence so a repeated notice restarts the fade; the current selection stays put. **The menu item stays enabled.** The session summary carries no "has a completed turn" fact (`completed` is the unviewed-finish reminder and `blank` rows already render no menu), so disabling Fork would need a new Host projection; the notice covers the gap for now.

Upstream touches (`packages/client/ui-workspace`, `packages/client/runtime`) are logged in FORK.md.

## Alternatives considered

**A native notification through `@idealize/notify`.** It reaches the person even when the window is hidden, but a right-click action in the sidebar wants an in-page answer, and the plain-browser fallback needs a granted notification permission.

**Forking without `increaseTitle` and renaming in the handler.** It would let the handler open the child after a rename failure, but it duplicates the runtime's title-increment rule in a second package; the runtime's documented two-error contract already separates the cases.

## Consequences

Tests: `ui-workspace/tests/apply.client.spec.ts` (the three rejection paths in zh and en), `ui-workspace/tests/workspace-browser.client.spec.tsx` (the alert from a row-menu fork). Disabling Fork on a chat with no completed turn is open until the Host's session summary carries that fact.
