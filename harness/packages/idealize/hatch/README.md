# @idealize/hatch

The composition inspector and service hatch: every profile's layer stack (bundle patches, then the profile patch, then the home patch), the effective entry list they compose to, and safe editing of the home patch with snapshots and rollback. It also finds the IDEalize source checkout and opens it as a project so an amend chat can start there. The `idealize-hatch` row of the `idealize` profile bundle mounts it; `@idealize/ui-bar`'s Service pane is the surface most users reach it through. Composition changes apply on restart.

## Home-patch editing

Every save validates the new YAML through the same loader `app-boot` uses (an empty file is a valid absent layer; anything that is not a top-level list is refused) and snapshots the previous content under `<DSH_HOME>/hatch-snapshots/` before writing. A rollback snapshots the current content first, so a rollback is itself reversible.

## Routes (loopback; mutations need `x-idealize-auth: 1`)

- `GET /idealize/hatch` → the inspector page.
- `GET /idealize/hatch/composition` → profiles with their layers (`packageName`, `patchCount`), profile-patch row count, effective entries, and `homePatchCount`.
- `GET /idealize/hatch/home-patch` → the home patch file, verbatim; `POST /idealize/hatch/home-patch` `{ content }` → validate, snapshot, save.
- `GET /idealize/hatch/snapshots` → snapshot names, newest first; `POST /idealize/hatch/rollback?name=` → restore one.
- `GET /idealize/hatch/service` → the service source checkout path, whether it passes the fork-marker check (`FORK.md` beside `package.json`), and the workspace id when it is already open as a project.
- `POST /idealize/hatch/service` `{ path }` → validate the fork markers and persist the path into the settings user layer, answering with the fresh report; refused with 422 when the markers are missing and 503 while no settings provider is mounted.
- `POST /idealize/hatch/amend` → open the service source as a project, so an amend chat starts in a folder whose `AGENTS.md` briefs the agent.

## Configuration (`idealize-hatch` row)

| Field | Default | Meaning |
|---|---|---|
| `serviceSource` | `~/dev/idealize` | Absolute path of the IDEalize source checkout the amend flow opens. The `idealize-hatch` settings namespace layers over this, so an edit through the service route (the Service tab's Edit button) wins over the composed value and survives restarts. |

## Model Experience

Indirectly, through the project the amend route opens, whose `AGENTS.md` reaches the model through the workspace-context plugins that own project instructions.

#### KV Cache effect

Independent: the package writes composition files and opens a workspace; it adds nothing to any request, and the amend chat's prefix is the ordinary one for a session in that folder.

## Known Limitations and Deferred Work

- **Edits apply on restart only.** The hatch validates and saves the home patch but cannot re-compose the running tree; the running app, including any chat open through the hatch, ends when it restarts.
- **The service source is found by convention.** Without `serviceSource` the hatch looks at `~/dev/idealize` and reports "no source checkout found" otherwise; there is no search, only the Service tab's edit.
- **Validation is syntactic.** The loader parse catches malformed YAML and non-list documents, not a row that names a package the installation lacks; that fails at the next boot.
