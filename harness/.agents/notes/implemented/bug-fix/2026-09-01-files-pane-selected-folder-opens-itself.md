# Agent Note: Files pane — the selected folder lists itself, with no root row to click

Status: implemented

## Problem

Each Files tab (This project, All projects, Documentation) rendered its folder twice — the toolbar named it and a collapsed root row repeated it — and showed no contents until the user clicked that row (JJ, 2026-09-01, screenshot of "_AppDev" appearing as both header and collapsed `>` row). The user had already selected the folder by choosing the tab; the click bought nothing.

## Decision

`LazyTree` in `packages/idealize/ui-bar/src/client/FilesPanel.tsx` lists its roots on mount and renders them open. The recorded state is the user's explicit folds (a `folded` set), not opens — the same inversion `packages/client/ui-workspace`'s sidebar tree made for project groups (`collapsedGroups`, FORK.md). Deeper folders stay lazy and collapsed until clicked, so a tab entry costs exactly one listing per root.

A lone root — every tab in practice, and the browse pane's home folder — renders no row at all: the pane's header (the toolbar target, or the Browse header) already names it, and its children render directly at depth 0. The container inherits the root's responsibilities: it is the drop zone for moves to the root and answers background right-clicks with the root's folder menu. The shared `dropZone` handlers now call `stopPropagation`, because a lone root's zone is the first zone to wrap the row zones. Several project roots (project tab with no active chat) keep their rows, open until folded.

Fold state stays component-local and resets with the tree's `key={activeTab}` remount, matching the previous expansion state's lifetime.

## Alternatives considered

- **Keep the root row and merely seed it expanded.** Rejected: the folder name would still appear twice (toolbar and row), which is the presentation JJ flagged.
- **Persist folds across tab switches or sessions.** Rejected for now: the previous expansion state was equally ephemeral, and no feedback asks for remembered folds; the sidebar precedent's essence is the default, not persistence.
- **Auto-expand every directory, not just roots.** Rejected: each level is one fenced listing fetch and every Files listing probes each alias (README's known limitation), so opening a whole tree eagerly multiplies I/O for folders the user never looks at.

## Consequences

- One listing fetch per root fires on every tab entry and browse-pane open, where before it waited for a click; the refresh, create and move re-list paths are unchanged.
- The root's Reveal in Finder hover action went with its row; Reveal remains on the background right-click menu.
- Tests: `packages/idealize/ui-bar/tests/files-panel.client.spec.tsx` drops every root-row click, pins the no-root-row presentation, multi-root default-open with fold memory, background drop-to-root, and the background folder menu.
