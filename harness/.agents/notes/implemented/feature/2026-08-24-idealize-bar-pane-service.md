# Agent Note: The rail's pane closures as a service

Status: implemented

English | [中文](2026-08-24-idealize-bar-pane-service.zh.md)

## Problem

The desktop mini shell rebuilds V0's compact five-tab window: its Files, Doc and Style tabs must host the same drawer and deck panes the rail opens. The pane transitions lived as closures inside `@idealize/ui-bar`'s apply body, reachable only from the rail's own entries — a shell that renders no rail had no way to open a pane. The desktop client also must not import the pane components: it hand-declares vendored contracts and receives the `@idealize` plugins through profile composition at runtime.

## Decision

**`ctx.idealizeBar` (`IdealizeBarService`) exposes the existing closures as a service.** `show`/`close` drive the drawer panes; `openFile`/`closeFile` are hoisted out of the drawer/deck inject faces and drive the deck; `state` is the read-only view store. The plugin body stays the single writer — the service and the rail's entries share one closure set, so the drawer/deck columns (`ctx.layout`) and the appearance service's open flag stay in step whichever caller opens a pane. The service is provided with `ctx.reflect.provide` on the plugin's fiber and leaves with it; `tests/apply.client.spec.ts` is the composition proof.

## Alternatives considered

- **The mini frame importing `DrawerPanel`/`DeckPanel` directly.** Rejected: the desktop client's build must stay free of `@idealize` imports, and a second host would duplicate the pane wiring the drawer already owns.
- **A mini-owned copy of the pane state.** Rejected: two writers for one drawer let the rail and the mini tabs disagree about which pane is open.

## Consequences

Every shell — the rail, the mini tabs, or any future host — opens panes through the one closure set, so drawer, deck and appearance state cannot fork between hosts.
