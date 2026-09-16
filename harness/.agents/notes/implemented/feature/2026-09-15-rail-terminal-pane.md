# Agent Note: the tool rail's Terminal pane

Status: implemented

Owners: `packages/idealize/ui-bar` (the entry and the seat), `packages/idealize/ui-terminal` (the pane component and the plain open), 15 Sep 2026.

## Problem

The only terminal in the app was a chat's Terminal space, which starts by typing a command-line agent into the shell. JJ wanted a place to run ordinary commands beside whatever chat is open: "a plain terminal - no cli etc. just for running commands", opened from the right-hand tool rail and styled like the main terminal view.

## Decision

The rail gains a Terminal entry, under Files, which opens a `terminal` drawer pane. The pane is `@idealize/ui-terminal`'s own `TerminalView` (the same xterm.js grid, cache and appearance paint as the chat view) over one shell keyed `idealize-terminal-pane`, published on the existing `ctx.terminalMode` service as `Pane` because the client bundle purity gate forbids importing the component across plugins. The open route takes `plain: true`: the host types no launch command and records no chat for the activity watcher, so the shell's output never posts a "finished a run" line to the Studio. The shell starts in the current chat's project (else home) the first time the pane opens; closing the pane unmounts the grid but keeps the shell and its scrollback, so reopening reattaches.

The entry follows the terminal service: `ctx.inject(['terminalMode'])` asks the memoised probe and writes `terminalAvailable` into the bar's view store; the fiber's disposer clears it and closes an open Terminal pane, so a plain browser never shows the entry and the drawer never shows an empty seat.

## Alternatives considered

- **Reusing a chat's Terminal space.** It records a chat, types the brain's launch command and archives with the row; a command scratchpad should do none of those.
- **A second xterm stack inside ui-bar.** Two copies of the grid, its cache and the paint subscription; the service channel already existed for `open` and `restart`.
- **One pane shell per chat.** The pane sits beside every chat and JJ asked for a plain terminal, not a per-project one; one shell keeps the model simple. A per-project pane is a follow-on if asked for.

## Consequences

The rail offers a plain shell beside any chat wherever the terminal service is present, and nothing where it is not. The pane's shell records no chat and types no launch command, starts in the open chat's project (else home) and keeps its scrollback across close and reopen. The chat's Terminal space is unchanged.

## Evidence

`ui-terminal/tests/routes.client.spec.ts` (a plain open types nothing and names no working chat), `ui-terminal/tests/pane.client.spec.tsx` (one plain shell under the pane key; close and reopen reattach), `ui-bar/tests/rail.client.spec.tsx` (the entry appears under Files only with `terminalAvailable`; the drawer seats the grid in the current folder) and `ui-bar/tests/apply.client.spec.ts` (the entry follows the service's probe and leaves with its fiber).
