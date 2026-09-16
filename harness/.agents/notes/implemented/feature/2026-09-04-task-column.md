# Agent Note: the agent's task list as a column beside the tool rail

Status: implemented

JJ, 24 Aug 2026 (backlog): "when a chat works through multiple tasks, show the agent's task list as a full-height column to the LEFT of the tool rail." Reference image `.idealize/reference/task-list-hermes-reference.png`.

## Problem

A chat working through several tasks showed its list only as `TodoPanel`, the composer's plan strip, which folds to one summary line ("1 completed · 1 in progress · 3 pending") and starts collapsed. Reading what the agent is doing meant opening the strip, which then took height from the conversation. There was nowhere in the frame for a standing list.

The frame also had no seat for one. Its columns are sidebar, conversation, details, rail, deck and drawer; `details` is occupied by the tool-details panel, the deck and drawer are the resizable document panes, and `shell.overlay` floats over content instead of taking width from it. A full-height column left of the rail did not exist.

## Decision

**A new `shell.aside` slot in the frame.** An auto grid track immediately left of the rail, sized by whatever occupies it, current-session-optional so the occupant keeps its own state across a chat switch. Like the rail it is fixed content: its measured width leaves the column concession solve rather than competing in it, so opening it never pushes the deck or the drawer below their floors.

**The narrow breakpoint reads the window, not what the aside left of it.** The concession viewport subtracts the aside, but `SIDEBAR_AUTO_COLLAPSE` is decided on the frame minus the rail alone. Without that split the first proof run collapsed the projects sidebar to its 56px rail the moment the task column appeared on a 1280 window: answering one request by undoing another.

**`@idealize/ui-tasks` fills the seat** with the `todos` projection `@deepseek-ai/dsh-tool-todo` already computes from `todo_write`. Nothing is fetched or stored. An empty list renders nothing, which is what keeps the column out of the layout: no list, no column, no width lost.

Row treatment follows the reference: dashed ring for not started, spinning accent ring for the task in progress, ticked ring with the line struck for finished. The header counts the finished against the whole list and folds the rows away, keeping the count.

## Consequences

A chat with a task list is 269px narrower in the conversation column, measured. The proof pins that the conversation gives up exactly the column's width, so this is a real grid track and not a panel over the chat.

The composer's plan strip is shadowed since 8 Sep 2026: this package registers an empty occupant on the strip's dock cell (`conversation.input.dock`, id `todo`, priority -1) after JJ saw the list twice ([note](../bug-fix/2026-09-08-plan-icon-scope-strip-words-one-task-list.md)); an install without the column shows the strip again.

`shell.aside` is a general seat, not a task-list seat. Any single full-height column left of the rail can take it, and only one occupant at a time — a second view wanting the position replaces the first.

## Alternatives considered

**Put the list in the drawer or the deck.** Both are the document panes, opened and closed by `ctx.layout` from the tool rail. A task list a person has to open, that closes whatever they were reading, is not a standing column.

**Render it into `shell.overlay`.** It floats above the columns and is click-through, so the list would cover conversation text at the exact width the reader needs. The seat exists for badges and toasts.

**Widen the plan strip instead.** It is above the composer, so it grows downward into the conversation and pushes the composer about; the reference is explicitly a column beside the work.
