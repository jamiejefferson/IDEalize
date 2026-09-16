# Agent Note: IDEalize artefact engine — one record contract, per-project bytes, ignorable session events

Status: implemented

English | [中文](2026-08-24-idealize-artefact-engine.zh.md)

## Problem

IDEalize V1 adds Gallery and Sound Stage beside the two chat modes, and the multi-activity spec (MOD-03/MOD-06) requires every generated result to enter one common artefact engine and stay addressable from any mode by a shared identifier. Nothing in the fork stored generated media: bytes had no home, no durable record correlated an output with the task that produced it, and the transcript could not show a generated image or sound. The spec also left retention and storage location open (OQ-04), which blocked the shared artefact contract.

## Decision

`@idealize/artefacts` is the complete capability seam in one package: the `ctx.artefacts` Service Definition with its local provider, plus the two Consumers that exist today (the loopback raw route and the `artefacts_get` tool). The record (schema version 1) is keyed by a branded `ArtefactId` and carries `mediaType`, `storage { kind: 'file', relPath, bytes, sha256 }`, `sourceTask { sessionId, turnSeq, callId, toolName }`, `settings`, and `provenance { provider, model, createdAt, workspaceId }`. Records live in the `idealize_artefacts` storage domain (`dsh-storage-domain`, the `dsh-workspace` spec pattern); bytes live per project at `<projectRoot>/.idealize/artefacts/<yyyy-mm>/<id>.<ext>` with `relPath` stored project-relative, and V1 applies no automatic retention — this note records the OQ-04 decision. `resolve(id)` derives the absolute path through `workspaceRegistry.get(provenance.workspaceId)`, so a moved project fails loud rather than silently pointing elsewhere.

`create()` streams and hashes the bytes, commits the record, and only then appends `artefact/created` (whole record) to the producing session; a failure appends `artefact/failed` with the provider cause and removes the partial file. Both events are non-surface, and both are appended with `{ ignorable: true }`: the store is the source of truth, the events are informational projections, so an older build without this vocabulary may skip them instead of refusing the log. That required giving `Session.append` the envelope surface the [session-log version note](2026-08-10-session-log-version-mechanism.md) deferred to "its first user" — non-surface appends now accept a `NonSurfaceIntent { ignorable?: true }` options argument (an upstream touch, logged in FORK.md). The client half renders each event as a keyed `conversation.chat.node` (`kind: 'artefact'`): image thumbnail or audio element loaded through `GET /idealize/artefacts/raw?id=` (loopback-fenced; the resolved path must realpath inside the workspace's artefact directory, ui-bar's `fencedPath` pattern), generic card otherwise.

## Alternatives considered

**Store the project root inside the record** instead of resolving through the workspace registry. It would make `resolve()` self-contained, but duplicates a path the registry already owns, and a moved or re-created project would silently serve stale absolute paths; failing loud on an unregistered workspace is the safer read.

**A central artefact directory under the app home** instead of per-project storage. It survives project deletion, but artefacts are project work-product: keeping them under the project root makes them visible in the Files view, portable with the project, and trivially fenced. Retention policy stays open for a later slice precisely because deletion follows the project.

**Required (non-ignorable) session events.** Refusing a log on an unknown `artefact/*` type would protect nothing: reconstruction does not depend on these events (the store holds the truth), while V0-era builds would refuse every log a Gallery session ever touched.

**Events carrying only the artefact id** with the client fetching the record. Smaller events, but the transcript then depends on a live store for replay, breaking the model-visible ⟺ logged reconstruction rule and the cookbook's whole-value checkpoint guidance.

## Consequences

Every mode gains one route from generation to presentation: commit through `ctx.artefacts.create()`, render from the session log, address cross-mode by id (`artefacts_get` re-surfaces the record as model context). The cost is a workspace-registry dependency in the service and a fork-logged upstream seam on `Session.append`. Composition coverage boots the real Loader stack (storage → domain → sessions → persistence → workspace → webserver → artefacts) and proves create → event → record → raw-route 200/403/404; the chat node is covered by a jsdom spec over the Definition and renderer. A keyless transcript snapshot through a runnable example lands with the first slice that actually generates media (S2's Gallery submission path); until then no example emits artefact events. `verify-cordis-catalog` crashes on this tree before this change (typert analyzer fault), so catalog rows for `ctx.artefacts` ride with whichever change repairs that gate.
