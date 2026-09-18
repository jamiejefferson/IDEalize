# Agent Note: the Files pane splits every scope into project files and documentation, and hands other file types to their default application

Status: implemented

JJ, 18 Sep 2026: "in the files pane we're actually missing something. we should have a 'project files' and 'documentation' for each project. and then under All Projects, you'd have All project files, and all documentation." and "if a document is not an md file, clicking on it to open should open it in the appropriate default software."

## Problem

The Files pane had four tabs in one row: This project, All projects, Documentation, Skills. Documentation meant the whole vault, so a person working in one project had no view of that project's notes: they opened the vault and clicked down to `Projects/<name>/`, a path only the documentation rule's authors know. Nothing in the pane said that a project has two folders, its own and its documentation.

The folder itself had no owner the user could reach. `@idealize/doc-policy` finds a project's note through the `repo:` pointer in `Projects/<name>/_index.md`, and only agents read that. A project whose notes live somewhere else had no way to say so.

Every clicked file opened in the deck's viewer. The viewer renders Markdown and images; a PDF, a deck or a spreadsheet got the sentence "binary file" and nothing else.

## Decision

**Two rows of tabs, one new concept.** The first row picks whose files show: This project, All projects, Skills. The second row picks which of that scope's two folders: Project files or Documentation under This project, All project files or All documentation under All projects. The old Documentation tab becomes All projects' documentation view, so the pane keeps its three top-level places and gains one question, asked the same way in both scopes. The kind carries across a scope change: someone reading a project's documentation who switches to All projects lands on All documentation. Skills has one view and shows no second row. The scope tabs keep their `data-tab` ids (`project`, `projectsRoot`, `skills`); the second row carries `data-kind`.

**The five views are `viewOf(scope, kind)` over the host's existing folder sets.** `project`, `projectsRoot`, `documentation` and `skills` are the four `tabs` `GET /idealize/bar/aliases` already reports; `projectDocs` is new and reads the response's `projectDocs` array, one entry per registered project. The documentation view follows the project files view's narrowing (`currentProjectDocs` over `currentProjectRoots`), so it shows the project holding the active chat and, with no chat open, every project's folder under its project's name.

**A project's documentation folder is the vault's answer until the user picks another.** `ctx.docPolicy.projectFolder(projectPath)` returns the folder of the note whose `repo:` names the project, else `Projects/<project folder name>` compared without case. `ctx.workspaceAliases.projectDocumentation(projectPath)` in `@idealize/setup` puts a stored choice in front of that and probes whichever it returns. The choice is stored in the `idealize-setup` section as `projectDocs`, keyed by the project folder's path, beside the three aliases it resembles; the settings write merges, so a cleared choice is the empty string. `POST /idealize/setup/project-docs {project, path}` is the write, probing before it stores as the alias route does. The pane shows the folder's path above the tree with Change folder, and Use the default folder once a choice exists; a project with no folder, or a chosen folder that died, shows the reason and Choose folder where the tree would be, the same card a dead alias shows.

**All documentation is the vault plus every chosen folder outside it.** The vault root stays the view's first root, so Decisions, People and Reference remain one click away and the dead-vault Reconnect card is unchanged. A project's chosen folder outside the vault joins as a further root named `<project> · <folder>`. The listing fence (`aliasRoots`) includes every chosen folder; a folder the vault resolved is already inside it.

**Markdown and images stay in the viewer; every other file goes to its default application.** `opensInApp(path)` decides by extension: the viewer's Markdown set and the raw route's image set. `POST /idealize/bar/open` checks the viewer fence and runs `/usr/bin/open <file>`, the launcher the Reveal route already uses with `-R`, so the desktop shell needed no change. `GET /idealize/bar/capabilities` reports `openExternal` (macOS only); without it every file opens in the viewer as before. The route answers 422 for a folder, for a file macOS would run when asked to open it (`.command`, `.tool`, `.app`, `.workflow`, `.action`, `.terminal`, `.scpt`, `.scptd`, `.applescript`, `.pkg`, `.mpkg`, or an extension-less file with an execute bit), and for a type no application claims; the pane then opens the file in the viewer, as it does when the request fails. The row menu's Open follows the same rule and gains Open in IDEalize for a file that would leave. A file created from the toolbar still opens in the viewer, where it can be typed into.

## Alternatives considered

**Five tabs in one row (This project, Project docs, All projects, All documentation, Skills).** Rejected: the drawer's default width does not fit five labels, and a flat row hides that the two documentation views answer the same question in two scopes.

**A Files / Documentation switch first, with the scope second.** Rejected: JJ's wording puts the project first ("for each project … and then under All Projects"), and the chat the user is in already fixes the scope, so the scope is the row that changes least.

**All documentation as the vault's `Projects/` folder only.** Rejected: it drops Decisions, People and Reference from the pane, which the Documentation tab showed until now, and it cannot show a folder chosen outside the vault.

**Storing the chosen folder in the project note or in `idealize-docs`.** Rejected: a project with no note has nowhere to hold it, and `idealize-docs` describes the vault, not projects. The `idealize-setup` section already holds the folders the user chose and already has the probe-then-store write.

**`shell.openPath` through the desktop shell's action service.** Rejected for now: it needs a new `desktopActions` method in the desktop repository and a vendoring round for the same result `/usr/bin/open` gives, and it leaves a browser-hosted session on the same Mac without the feature. The route can prefer a shell method later, as the trash route does.

**Deciding by the viewer's `binary` verdict instead of the extension.** Rejected: JJ's rule is about file type, a code or text file belongs to the editor the user set as its default, and the verdict costs a read of the file before anything opens.

## Consequences

`@idealize/doc-policy` gains `projectDocsFolder` and `ctx.docPolicy.projectFolder`; `@idealize/setup` gains `projectDocumentation`, `chosenProjectDocumentation`, `setProjectDocumentation`, the `projectDocs` settings field and its route; `AliasProbeError.alias` admits `projectDocumentation`. `@idealize/ui-bar` reaches the vault lookup only through `ctx.workspaceAliases`, so it takes no new dependency edge.

`GET /idealize/bar/aliases` now costs one `git rev-parse` and one read of the vault's project notes per registered project that has no chosen folder. The locale key `files.tab.docs` is gone; the second row's labels are `files.kind.*`.

A text or code file no longer opens in the in-app editor on a click where the host is macOS: it opens in the user's default editor, and Open in IDEalize on the row menu reaches the viewer. The host launcher is the exported `defaultApplication.open`, which the route suite replaces so no test starts an application.

Coverage: `doc-policy/tests/project-docs-folder.spec.ts` (note, name, precedence, misses), `setup/tests/setup.spec.ts` (resolution, choice, clearing, dead folder, refusal, the route), `ui-bar/tests/aliases.client.spec.ts` (`projectDocs`, the widened fence, All documentation's extra root, the open route's refusals) and `ui-bar/tests/files-panel.client.spec.tsx` (both rows, the five views, the chooser, reveal order, external open and its fallbacks). No proof script drives the pane in a packaged window; the two rows have not been looked at in the running app.
