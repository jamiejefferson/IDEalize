# Agent Note: Right-edge tool rail

Status: implemented

English | [中文](2026-08-20-right-edge-tool-rail.zh.md)

## Problem

The IDEalize toggle bar rendered as a pill in the frame's bottom dock strip. The "Dock launcher" Paper frame moves those icons to a 48px toolbar on the full right edge, stacked from the top, with the docked drawers opening to its left. The dock row spans only the bottom of the grid, so no existing seat could hold a full-height edge column.

## Decision

**ui-layout gains a `shell.rail` single root slot.** The rail now sits between the details and deck columns (`grid-column: 4`, columns row only) with the banner and dock strips spanning the full frame width; [rail inside the open panes](2026-08-24-rail-inside-open-panes.md) owns that placement. The occupant sizes the track (an explicit `auto` in the inline template); an empty rail has no width. AppFrame observes the rail's width alongside the frame's and subtracts it from the concession viewport, so the column solve never counts the rail.

**`@idealize/ui-bar` registers its bar into `shell.rail` instead of `shell.dock`.** Geometry comes from the Paper frame: 48px wide, 18px block and 13px inline padding, 10px gap, 22px hit boxes, 15px glyphs, 1px left border on the page ground. Icon order follows the frame (folder, sliders for the service hatch, calendar, globe for plugins, speech bubble, sun); the actions the frame does not draw (models, desktop terminal, mini mode) keep working and slot in beside their neighbours. The theme button still cycles the preference; a `TODO(appearance-panel)` marks the swap to `openAppearancePanel()` once that piece lands.

## Alternatives considered

**A fixed-position rail from the dock entry.** Rejected: it would cover the drawer and deck columns instead of pushing them aside.

**A sixth explicit width-valued track in the inline template.** Rejected: the frame would need to know the rail's width up front, and the occupant owns it. (The template now carries the rail as an explicit `auto` track — still occupant-sized.)

## Consequences

Every `shell.dock` registration still renders under the columns, spanning the full frame width. The deck and drawer open on the rail's right, flush against the window edge. The slot catalog lists `shell.rail`; FORK.md records the upstream touch.
