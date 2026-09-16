# Agent Note: the panel shows the chat's recent exchanges and fills the bar

Status: implemented

JJ, 14 Sep 2026, with a screenshot of minimode: "would it be possible to do something with this pop-out? animate it, and do something useful with the large blank space".

## Problem

A chip's panel is a 300px card at the top of a window the bar widens to 420px, and the window painted the page ground under and beside it, so most of the widened window read as a blank sheet. The card also appeared without motion, and once an ask was sent from it there was no way to see the answer without expanding the app.

## Decision

**The panel shows the chat's recent exchanges.** Between the status line and the ask field, `Panel` reads comm's `transcript` command for the chip's session (the same fold the Studio and the CLI read) and lists the last four question-and-answer pairs, newest last, scrolled to the end. It reads again every three seconds while open and once more after each send, so the answer to an ask made from the bar lands in the panel. A pair with no answer yet reads Working on it… while the agent runs, and No answer yet. otherwise. The design spec now lists six elements: JJ had it revised on 14 Sep 2026 to match.

**The panel fills the bar's window.** In the floating home the panel runs from the column's top inset to its foot and the exchanges take the room; in the sidebar home they scroll inside a 220px strip so the card beside the conversation stays compact.

**The bar's window is transparent.** `transparent: true` on the Askbar BrowserWindow, and the bar page's body paints nothing, so the widened window shows what is behind it except where the column and the panel paint.

**The panel slides in.** `askbar-panel-in` fades and slides the card 10px out of the column over 160ms, and reduced motion turns it off with the rest of the bar's animations.

## Alternatives considered

**A host route that serves the last messages.** comm already folds a session's events into exchanges for its `transcript` command, and the panel sends through the same route, so a second reader would duplicate the fold.

**Reading `session.history` from the bar page.** The API proxy serves raw session events; turning them into readable pairs in the client repeats comm's fold.

**Leaving the window opaque and painting the space.** A sheet of ground beside a card is what JJ called blank; the room is the panel's now, and what the panel does not cover is see-through.

## Consequences

- The panel makes one comm call every three seconds while open. A closed panel makes none.
- 142 askbar tests pass, including the transcript read, its refresh after a send, and the empty-chat line; the send assertions in the root, panel and voice specs now pick the send among the transcript reads.
- The Askbar window is transparent and, since 15 Sep 2026, asks for no OS shadow: macOS computed one from the pixels painted a frame earlier and kept it, which drew a stale rim behind a panel that had slid in (`2026-09-15-askbar-window-no-os-shadow.md`). The column keeps its own border and the panel its CSS box-shadow.
