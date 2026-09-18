# Agent Note: the terminal grid stays inside its column through every resize

Status: implemented

JJ, 18 Sep 2026: "the terminal view is not re-rendering correctly if the window size changes, or the type size in it changes, meaning you lose the ask bar at the bottom and it becomes unusable."

## Problem

A Terminal chat usually runs a full-screen agent UI that draws its input box on the grid's last rows. After the window got shorter, or the Appearance panel's terminal font, line height or margin grew, the grid kept its old row count: the last rows sat below the visible column and the input box went with them.

The view already refitted on a `ResizeObserver` and on a paint change, and both refits ran. They measured the wrong height. xterm gives `.xterm-screen` an explicit pixel height (rows times cell). The conversation's active-phase view area is `flex: 1 0 auto; min-height: auto`, so it grows to its content and never shrinks under it, and the terminal root's `height: 100%` follows it. The drawn rows therefore became the column's floor: a shorter window left the host as tall as the old grid, so the observer saw no change; a larger font made the screen taller first, the view area grew with it, and the fit addon divided that grown height by the new cell and kept every row. The scroll body scrolled instead (310px on a 1280x840 window shrunk to 520), under a grid that takes the wheel for itself. The 17 Sep typography opt-out (`e3ac1af54a`) changed which face the cell is measured from, which moved the sizes at which the fault showed; the cause predates it.

Two smaller gaps sat beside it. The PTY was told a size by whichever caller remembered to (`transport.resize` after each `fit()`), so a future refit path could resize the grid and leave the agent drawing for the old one. And xterm measures its cell when the font options change, never when the face behind them arrives, so a web font that finished loading after the grid opened left the cell sized for the fallback (148 columns told to the PTY where 94 fit, in the proof's late-face step).

## Decision

`.grid` in `TerminalView.module.css` carries `contain: size` and `overflow: hidden`. The host takes its height from its column alone, so the view area's content size no longer includes the drawn rows and the host shrinks with the window. The clip covers the one frame between a resize and its refit.

Grid size has one route in and one route out (`TerminalView.tsx`). In: `scheduleRefit` queues one fit per animation frame, and the host's `ResizeObserver`, `applyTerminalPaint` and `document.fonts`' `loadingdone` all end there; the font event first measures the cell again by setting the family to an equivalent stack and back, since xterm exposes no call for it. `refit` skips a host with no box, so a hidden view or a column dragged shut never shrinks the shell to the fit addon's one-row minimum. The mount still fits at once, because the open request reports that size. Out: the connection subscribes to xterm's `onResize` and posts every change of cols/rows to the host; an unchanged size posts nothing and an exited shell is left alone. `discard` cancels a queued fit wherever a grid is disposed.

## Alternatives considered

Changing the view area's rule in `ui-conversation` (`flex: 1 1 0; min-height: 0`, as the composer-overlay views already get) would fix the terminal and touch every other view's scrolling; it is an upstream file, and chat depends on the area growing with the transcript. Containment on the terminal's own host fixes it in the fork package with no FORK.md row.

Taking xterm out of flow (`position: absolute` inside a relative host) does the same job with more rules and moves the scrollbar's reference box; `contain: size` states the intent in one declaration.

Fitting synchronously inside the observer callback avoids one frame of stale grid. It also fits several times per frame during a drag and, on a paint change, fits before React has rendered the new margin; the frame queue settles on the layout the frame ends with.

Reaching into `terminal._core._charSizeService.measure()` for the late-font case is shorter than the family round-trip and breaks silently on an xterm upgrade; the option write is public API.

## Consequences

The agent's input box stays on screen through a window resize, a column drag, mini windows, every Terminal setting in Appearance, surface zoom and a view coming back from hidden, in the chat view and the drawer pane. The PTY cannot miss a grid size. One frame of the old grid is painted, clipped, before each refit. `root`'s `min-height: 240px` still holds, so a column shorter than that clips the grid rather than shrinking it further.

## Evidence

`packages/idealize/ui-terminal/proof/resize-proof.mts`, headless Chromium at 1280x840, 28 checks over the chat column and the pane: 13 pass and 15 fail on `main` (`bf2f74cd7f`), 28 pass and 0 fail on this change. Each check asserts the last row ends inside the visible frame, the frame has nothing to scroll, the stand-in's ask bar is on the last row, and the last size the PTY was told equals the grid's. `tests/resize.client.spec.tsx` covers the frame queue, the no-box skip, the paint and font paths, the exited shell, the disposed grid and the stylesheet rule. Not yet walked in the packaged window.
