# Agent Note: A3 fourth commit — source navigation restores position (FR-P0-23)

Status: implemented

Opening a chat from a Studio timeline row now lands the transcript at the referenced moment: `conversation.revealAt(sessionId, atMs)` writes a one-shot per-session reveal target, and the chat view's next mount of that session consumes it, scrolling to the turn nearest the instant and marking the landed row `data-chat-revealed`.

## Problem

The Studio pane's Open chat opened the source chat wherever the reader last was (or at the bottom). The chat view's scroll memory (`chatScrollPositions`) and its open-jump logic live inside `@deepseek-ai/dsh-client-ui-conversation`'s apply closure, so no plugin could aim the transcript at an instant — the seam FR-P0-23 needed did not exist.

## Decision

**One-shot targets beside the scroll memory.** A `chatReveals: Map<SessionId, number>` sits next to `chatScrollPositions` in ui-conversation's apply closure. The conversation service gains `revealAt(sessionId, atMs)` — explicitly addressed, unlike the scoped operations, because the caller navigates to another session's chat — and the view's injected `chatScroll` face gains `takeReveal()`, a read that clears.

**The instant maps through the snapshot's own clocks.** `revealRow` picks the turn whose `turnTimings` start is nearest at-or-before the instant, bounds it with `turnEnds` seqs, and lands on that turn's first rendered node — no per-kind payload is read, so every node kind navigates the same way. A target older than every loaded turn lands on the transcript head.

**A reveal outranks the reader position, once.** The mount that consumes it skips the saved-position restore, marks the row `data-chat-revealed` (the walk hook and a styling seam), and then hands scroll ownership back to the ordinary save/restore machinery.

**Studio aims it before opening.** `openThread(sessionId, at?)` parses the event's instant, calls `revealAt`, then `sessions.open` — write before open, so the mount the open triggers finds the target.

## Alternatives considered

**Scroll to an exact session event id.** Rejected: a studio event records `source.thread` and its own instant, never a session-event seq — the two logs do not share ids. The turn nearest the instant is what the records can honestly support.

**A reactive reveal store that also lands on the already-current chat.** Deferred: the mount-time contract is one map read; landing mid-mount needs the view to subscribe to reveal writes. The gap (a reveal aimed at the current chat waits for its next mount) is recorded in both READMEs, and the proof works around it the way a user would — by being on another chat.

**Auto-paging older history until the target loads.** Rejected for now: unbounded page pulls on a click; the head landing is stated instead.

## Consequences

- FORK.md logs the upstream touch (`contract/slots.ts`, `apply.ts`, `service.ts`, `chat/ChatView.tsx` + specs).
- The rendered proof now proves the loop end to end: a message delivered mid-run whose `source.thread` is the real live chat, Open chat pressed from a different chat, transcript landing on a `data-chat-revealed` row — 46 expectations green in both themes.
- The proof's `openStudio` became toggle-safe, and it reads the live session id off `workspace.list` (`items`, not a guessed field).
- `ChatViewInjected.chatScroll` grew a required member: harnesses that stub the face add `takeReveal`.
