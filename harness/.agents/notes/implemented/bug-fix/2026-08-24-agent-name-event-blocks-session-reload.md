# Agent Note: The agent-name event blocked every named chat's reload

Status: implemented

English | [中文](2026-08-24-agent-name-event-blocks-session-reload.zh.md)

## Problem

Every named chat showed "Failed to load history" on reopen, in the packaged app and for the same build that wrote the session. `@idealize/comm` appends `idealize/agent-name` to each new session, but the event entered the repository without regenerating `KNOWN_SESSION_EVENT_TYPES` (`packages/core/session/src/known-event-types.ts`) or `docs/persistence-catalog.md`, so the persistence read guard refused the whole log as "unknown to this harness and not marked ignorable" — the same build that wrote the event could not read it back. The append also never set the envelope's `ignorable` marker, so even a vocabulary-complete older or newer build would refuse the log.

## Decision

Three changes, one per failure axis:

- **The append carries `{ ignorable: true }`** (`packages/idealize/comm/src/service.ts`). The comm store (`<DSH_HOME>/idealize/comm.json`) is the name's source of truth and `ensureName` re-derives a missing log entry from it, so skipping the event cannot corrupt reconstruction — the exact case the envelope marker exists for, and the same call `@idealize/artefacts` already makes. New logs now load on any build, with or without the vocabulary.
- **The generated vocabulary is regenerated**, adding `idealize/agent-name` to `KNOWN_SESSION_EVENT_TYPES` and the persistence catalog. This is the repo-wide read-path registration ([session-log version mechanism](../architecture/2026-08-10-session-log-version-mechanism.md) rejected per-composition registration on purpose), so every composition that ships from this repository — packaged app, source launch, headless — reads the event, which is what recovers the logs already written without the marker.
- **No `SESSION_FORMAT_VERSION` bump.** Vocabulary growth is exactly what the per-event marker covers, and stamping `ignorable` on an existing event is not a structural envelope change; the mechanism note's bump criteria (header shape, envelope, core event semantics, surface mechanism) are untouched.

The gap that let this ship: the comm PR declared the `SessionEventMap` merge but never ran `gen-persistence-catalog`, and `verify-persistence-catalog` (a `doc-sync` leaf) was red on main without blocking the merge. The regeneration here clears that gate; treat a red `doc-sync` as merge-blocking for any PR that touches a `SessionEventMap` merge.

## Alternatives considered

- **Marker only, no vocabulary regeneration** — new sessions would load, but every log written since the event shipped would stay refused; the generated list is what makes them readable again.
- **Vocabulary only, no marker** — this build would read its own logs, but any composition without comm's declaration (an older packaged build, a leaner future profile after a repackaging) would refuse them; decorative metadata must not hold the log hostage.
- **A per-plugin runtime registration surface** — already rejected by the mechanism note: it would make the known set composition-dependent, so a leaner same-version composition would refuse logs a fuller one wrote.

## Consequences

Pre-fix logs (written without the marker) load on builds carrying this regenerated vocabulary; they still refuse on older builds, which is the loud direction the mechanism chose deliberately. The `session-format-guard` snapshot suite now also pins the acceptance side: a log carrying an unknown event marked `ignorable` resumes through the assembled Loader composition and the foreign event survives re-persistence verbatim.
