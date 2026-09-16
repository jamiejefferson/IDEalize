# Agent Note: the Askbar window asks for no OS shadow, so a panel sliding in leaves no stale rim

Status: implemented

Date: 2026-09-15, idealize-desktop `eb06c3f8b4`.

## Problem

JJ, 15 Sep 2026, with a zoomed screenshot of a panel corner in the floating bar: "fix the weird misaligned border behind the minimode slide-out". A dark rounded line ran around the panel card, offset from it: 9px to the panel's slide-in side, 1px above and 18px below (measured on his 19:20 screenshot by a second session).

## Cause

The Askbar `BrowserWindow` is `transparent: true` and left `hasShadow` at its default. macOS computes a transparent window's shadow from the pixels it painted and keeps that shape until the app invalidates it. The panel arrives with a 160ms slide (`--askbar-panel-from`, 10px) and a fade, so the shadow was computed from an early frame and then stayed there as a hard rim, offset by the slide and by the OS shadow's downward offset. The 14 Sep note claimed macOS drew no shadow for the window; it did.

## Decision

`hasShadow: false` on the Askbar window (`dsh-plugin-desktop/src/askbar-window.ts`). The column keeps its 1px border on the inner edge and the panel its CSS `box-shadow`, so nothing the design relied on is lost, and no shape ever needs `invalidateShadow()` timing against the panel's animation or the pointer-following opens.

## Alternatives considered

Calling `invalidateShadow()` after the panel's slide and fade would have kept the OS shadow at the cost of timing a call against a 160ms animation and against every pointer-following open, with a stale rim visible whenever the timing slipped. Painting the panel without animation would have removed the stale frame and the design's slide with it.

## Consequences

- The column's inner edge loses the OS shadow's soft gradient over the app behind it; the 1px border remains.
- `tests/askbar-window.spec.ts` pins `transparent: true, hasShadow: false` on the created window.
- The 14 Sep panel-recent-exchanges note's shadow line is corrected.
