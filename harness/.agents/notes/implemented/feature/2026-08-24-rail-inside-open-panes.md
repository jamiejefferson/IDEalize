# Agent Note: Rail inside the open panes

Status: implemented

## Problem

The tool rail sat pinned to the window's right edge as the grid's last track, with the deck and drawer opening between the conversation and the rail. JJ wants the rail to stick to the open drawers instead: the rail rides the inner (left) edge of whichever right-side panes are open, and pane content sits flush against the window edge. With no deck/drawer open their tracks are 0 wide, so the rail must still land on the window edge in that case.

## Decision

The `shell.rail` track moves between details and the deck: the inline template becomes `sidebar | minmax(0, 1fr) | details | auto | deck | drawer`, with every column's grid position set explicitly in the module CSS. The rail occupies the columns row only. The banner and dock strips span the full frame width (`grid-column: 1 / -1`): with the rail inboard it is no longer an edge fixture, so the strips own the whole top and bottom rows, including the rail track's cell.

The concession solver is untouched — the rail was already measured out of the viewport — so the sidebar's step-4 rail concession and the drawer's 1280-window drag range hold. Drag-handle offsets split: the details handle keeps its viewport arithmetic (frameWidth − rail − details − deck − drawer ≡ viewport − details − deck − drawer, because the rail sits between details and the deck), while the deck/drawer handles offset from the frame width, since those columns sit beyond the rail.

The rail's own 1px left border (ui-bar) now separates it from the center/details; the divider on its right comes from the open deck/drawer column's existing `border-left`, and a closed pane paints no border, so ui-bar needed no change.

## Alternatives considered

**Keep the rail full-height and stop the banner/dock strips at it.** Rejected: a grid item cannot span discontinuous columns, so the strips could not reach the deck/drawer columns at the window edge without overlapping the rail's cell and overpainting whichever renders later.

**Reorder tracks in the inline template only, leaving sparse auto-placement to seat the columns.** Rejected: auto-placement does seat them today, but the implicit seating breaks silently the moment any column gains an explicit position; the CSS names every column's track instead.

## Consequences

The rail is no longer a fixed edge landmark: it moves as panes open and close, and a banner or dock entry now runs the full window width. Supersedes the placement half of [right-edge tool rail](2026-08-20-right-edge-tool-rail.md); the slot itself, the width measurement out of the concession viewport, and ui-bar's occupancy are unchanged.
