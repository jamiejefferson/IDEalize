# Agent Note: the Files pane's three alias tabs and its widened fence

Status: implemented

## Problem

The Files pane showed one tree, rooted at the registered workspaces, and reached anything else only through the subordinate "Browse this computer" pane starting at home. First run had just captured two folders as workspace aliases — the projects root and the documentation vault (`@idealize/setup`, JJ's OQ-01 revision) — and neither was reachable in one click. Worse, the listing route fenced to workspace roots only, so a vault that lives outside every project could not be listed at all, and a vault file could not open in the viewer.

A dead alias made this sharper: when the captured folder moves or its drive unmounts, dropping the folder silently leaves the user with no way back. The pane has to keep saying which folder it lost and offer the way to re-point it.

## Decision

The single row of tabs this note describes became two rows on 18 Sep 2026: [project files and documentation](2026-09-18-files-pane-project-files-and-documentation.md) owns the arrangement; the route, the fence and the dead-alias card below are unchanged.

**One route reports the tabs; one fence serves all three.** `GET /idealize/bar/aliases` returns the tabs in header order — `project` (the registered workspaces), `projectsRoot` and `documentation` (the two aliases) — each with its roots and the alias's live probe verdict, so the panel never has to ask `@idealize/setup` a second question to decide what to render. Listings still go through `/idealize/bar/files`, so each tab is a `LazyTree` over the same endpoint with different roots.

**The fence widens to the captured folders and to nothing else.** Both existing helpers gain the alias roots: `fencedPath` (workspace roots) and `viewFencedPath` (home + workspace roots, used by the viewer, raw, reveal and create routes). One `aliasRoots()` helper resolves each stored alias through `realpath` before it joins the root list, so an alias reached by symlink fences its real location; an unset alias, a folder that has vanished, and a composition without `@idealize/setup` all contribute no root. The prefix check moved into a shared `insideRoots`, so the two fences cannot drift.

**A dead alias keeps its tab.** Its tab carries a dot, and where the tree would be the panel shows the host's own plain-language reason verbatim plus a Reconnect button: the picker (`ctx.workspaces.pickDirectory()`, plumbed through the drawer) into `POST /idealize/setup/alias`, whose seam re-probes and re-seeds before it stores. A refused folder answers with its own sentence, which the status line shows unchanged.

**The project tab means the current project.** The host cannot know which chat is open, so it reports every registered workspace and the panel narrows: `currentProjectRoots` keeps the root holding the active chat's `cwd`, and falls back to all of them with no chat open or a cwd under none.

## Alternatives considered

**Probing the alias inside the fence and admitting only `ok` folders.** Rejected: the probe includes a write check, so a read-only vault would drop out of a read fence. The fence admits any stored alias folder that resolves; a folder that cannot be read simply lists nothing.

**A fourth endpoint per tab.** Rejected: `LazyTree` already takes `endpoint` + `roots`, and one fence with three root sets is one thing to audit rather than three.

**Deriving the projects root from the current project's parent (the plan's OQ-01 proposal).** Superseded by JJ's revision: first run captures the projects root and the vault directly, so both are stored aliases and nothing is derived.

## Consequences

`@idealize/ui-bar` now depends on `@idealize/setup` for the alias vocabulary, type-only — the service is read through `ctx.get('workspaceAliases')`, so a composition without it keeps the project tab and shows the other two as never chosen. Every listing costs one probe per alias (a `stat`, a `readdir` and a throwaway dotfile write per captured folder), which is what makes a folder that died since the last render show its Reconnect card without a reload.

The host-route suite lives in `tests/aliases.client.spec.ts`: the package registers in the client typecheck aggregate, so its host tests take the `.client.spec.ts` name, as `@idealize/ui-terminal`'s route suite already does. It composes the real settings provider, web server and alias seam; the workspace registry stands in, because its storage-domain stack is host-only.
