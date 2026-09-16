# @idealize/artefacts

The artefact engine: the complete capability seam in one package. `ctx.artefacts` is the Service Definition with its local file-plus-domain provider; the loopback raw and disposition routes, the media-folders settings row and the `artefacts_get` tool are its Consumers. Every mode commits generated results here, and any mode can address another mode's artefact by its shared `ArtefactId`. The `idealize-artefacts` row of the `idealize` profile bundle mounts the host half; the browser half renders the two artefact events inline in the transcript and seats the folders row in General settings.

## Records and bytes

A record (schema version 1) carries `id`, `mediaType`, `storage { kind: 'file', relPath, bytes, sha256 }`, `sourceTask { sessionId, turnSeq, callId, toolName }`, `settings` (the generation settings JSON exactly as the producing task supplied it), `provenance { provider, model, createdAt, workspaceId }` and, once archived, `disposition: 'archived'`. Records live in the `idealize-artefacts` storage domain; bytes live per project at `<projectRoot>/<folder>/<yyyy-mm-dd>_<id8>.<ext>`, where `<folder>` is the media kind's folder from the [settings](#where-media-saves), `<id8>` the first eight characters of the id and the extension chosen from the media type, `.bin` for anything unlisted. `ctx.artefacts` offers `create`, `get`, `list` (filtered by workspace and by media type or type prefix such as `audio`), `resolve` and `setDisposition`. `resolve(id)` derives the absolute path through the workspace registry, so a moved project fails loud rather than pointing elsewhere. Readers reject any other schema version at the durable boundary.

`create()` streams the bytes to the owning workspace, hashes them, commits the record, and only then appends `artefact/created` (the whole record) to the producing session. A failed write removes the partial file and appends `artefact/failed` with the provider cause. `setDisposition(id, 'archived')` moves the file into the archive subfolder of its folder (`Images/Archive/…` by default), `'kept'` moves it back; the record's path follows the file and `artefact/disposition {artefactId, disposition, relPath, sourceTask}` is appended to the producing session while it is live (the store stays the source of truth for an archived chat). All three events are non-surface and carry the envelope's `ignorable` marker, so a build without this vocabulary reads the log and skips them. The package's invariant companion fails the run if an `artefact/created` event reaches observers before the store resolves its record.

## Where media saves

The `idealize-artefacts` settings section (`ARTEFACT_SETTINGS_NAMESPACE`, schema `ArtefactFolderSettingsSchema`) holds five project-relative folders: `images` (default `Images`), `sounds` (`Sounds`), `video` (`Video`), `other` (`Artefacts`) and `archive` (`Archive`, the subfolder each kind's archived files move into). A folder is one or more `/`-separated segments with no `.`, `..`, leading or trailing slash, backslash or NUL (`FOLDER_PATTERN`), so a project stays self-contained. The browser half seats one `settings.general.item` row (`idealize-artefact-folders`, "Where generated media saves") that edits the four kind folders and the archive name, commits a valid value on blur or Enter, marks an invalid one and writes nothing for it. A change applies to the next generation; existing files stay where they are and their records still resolve. Every agent's prompt names the folders in force (the section below), so a chat asked about another chat's file lists the folder instead of searching transcripts.

## Routes

- `GET /idealize/artefacts/raw?id=` (`RAW_ROUTE`) serves a record's bytes with its media type as `content-type`. Loopback only; the resolved path must realpath inside the project root or the request is refused.
- `POST /idealize/artefacts/disposition` (`DISPOSITION_ROUTE`) with `{id, disposition: 'kept' | 'archived'}` is the Gallery's Keep and Archive. Loopback plus the `x-idealize-auth: 1` mutating-request header; a malformed body is a 400, an unknown id a 404, and the response is the updated record.

## Browser half

The client registers the `artefact` conversation-node Definition and a keyed `conversation.chat.node` renderer, so `artefact/created` renders as an image thumbnail, an audio element, or a generic card by media type, and `artefact/failed` renders the cause. `@idealize/ui-gallery` and `@idealize/ui-soundstage` read the same events for their views; the Gallery also folds `artefact/disposition` to move a tile into or out of its archived fold. The folders settings row binds the `idealize-artefacts` settings scope through `settingsScope`.

`src/client/reveal.ts` also carries the landed signal: `ArtefactNodeView` calls `announceArtefact(relPath)` once a created artefact's node is in the transcript (the `idealize:artefact-landed` document event, `ARTEFACT_LANDED_EVENT`), and `onArtefactLanded(listener)` subscribes; `@idealize/ui-bar` re-lists every folder its Files pane has loaded, so a folder the artefact created (the first video's `Video/`) shows without a manual Refresh (JJ, 16 Sep 2026). `src/client/reveal.ts` is the Reveal signal those galleries raise beside Archive: `requestReveal(relPath)` dispatches the `idealize:reveal-artefact` document event (`REVEAL_ARTEFACT_EVENT`) with `{ relPath }`, the artefact's project-relative storage path, and `onRevealRequest(listener)` subscribes and returns the disposer. `@idealize/ui-bar` listens, resolves the path against the current project's root and opens the Files pane on the file. Galleries and the rail import that one module by its `src/client/reveal.ts` path: a plugin bundle inlines it, and it holds no state to duplicate, whereas the `/client` entry is the loader bundle itself and cannot be inlined.

## Model Experience

### The folders section

#### What the model sees

One prompt section (`FOLDERS_SECTION`, name `idealize:artefacts`, order 121 in the tool-guidance band, after `@idealize/comm`'s command section) registered through `dsh-system-prompt` on every composition that mounts this package, with the `{{idealize_artefact_folders}}` variable filled from the settings in force at each assembly (`describeFolders`).

##### The folders section, at the default settings

```markdown
Files generated in this project are saved under its root: images in Images/, sounds in Sounds/, video in Video/, anything else in Artefacts/ (archived files under each folder's Archive/). Each is named <yyyy-mm-dd>_<id8>.<ext>, newest last by name, and an archived file moves into that folder's Archive subfolder. Another chat's images, sounds and video are there too: list the folder or call artefacts_get with the id rather than searching transcripts.
```

#### Token effect

Fixed: three sentences on every request of every session.

#### KV Cache effect

Prefix-stable while the folder settings are unchanged; editing a folder in Settings renders a different sentence and starts a new prefix on every later request.

### The `artefacts_get` tool

#### What the model sees

One tool definition, `artefacts_get`, with a single required string parameter `id` and this description: "Look up a generated artefact by id. Returns its media type, byte size, sha256, generation settings, provenance, and the absolute file path holding the bytes. Artefact ids come from artefact/created events and stay valid across chats and modes." The tool is registered on every composition that mounts this package, so it is visible in every mode's chat. It has no anchored section in the generated tool catalog because that generator globs `packages/*/tool-*`.

#### Token effect

A fixed schema cost on every request of every session, whether or not the chat generates anything.

#### KV Cache effect

Prefix-stable: the definition is constant, so it does not invalidate reuse.

### The `artefacts_get` result

#### What the model sees

One text line per call: `<mediaType> artefact <id> (<bytes> bytes, <provider>/<model>) at <absolute path>`, backed by the structured output (`id`, `mediaType`, `path`, `bytes`, `sha256`, `settings`, `provider`, `model`, `createdAt`, `workspaceId`, `sessionId`, `turnSeq`, `callId`, `toolName`). An unknown id fails the call with the tool's error message. The `artefact/created` and `artefact/failed` events themselves are non-surface and never enter derived history; a generation tool's own result (owned by `@idealize/gen-tools`) is what tells the model an artefact exists.

#### Token effect

Small and fixed-shape per call; the artefact bytes never enter the request.

#### KV Cache effect

Append-only: results follow the reusable request prefix and do not invalidate existing entries.

## Known Limitations and Deferred Work

- **No automatic retention.** Bytes stay under the project root until the user deletes them or the project; archiving moves a file into the archive subfolder and never deletes it. The retention decision is recorded in the [artefact engine note](../../../.agents/notes/implemented/architecture/2026-08-24-idealize-artefact-engine.md) and a retention policy would be a new slice.
- **Renaming a folder does not move existing files.** A changed folder setting applies to the next generation; earlier records keep their recorded path, and the raw route still serves them from wherever they are inside the project.
- **No HTTP listing route.** `list()` exists on the service, but only the raw route is served over HTTP; `@idealize/ui-soundstage` serves its own project-wide listing route and `@idealize/ui-gallery` reads the session log. One media-type-parameterised listing route here would replace both.
- **Only the media types in `EXTENSION_BY_MEDIA_TYPE` get a meaningful extension.** Everything else stores as `.bin`, which the Files view and the OS cannot open by type.
