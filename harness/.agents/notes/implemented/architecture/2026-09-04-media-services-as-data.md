# Agent Note: a media service is a directory row, not a package

Status: implemented

JJ, 4 Sep 2026: "fal blocker - i don't want the api baked in, i want it easier to add a service like fal." Wave F, items F1, F2 and F4 of `.idealize/plans/feedback-wave-f-plan.md`.

## Problem

Every media service the app could generate with was its own cordis package mounted as its own row in `bundle-idealize/cordis.patch.yml`. `@idealize/gen-fal` and `@idealize/gen-openrouter` each held four separate things: a snapshot of their vendor's model catalogue in TypeScript, that vendor's endpoints, that vendor's auth scheme, and the wire protocol. Only the last is behaviour. The other three are facts about a company, and holding them in code made adding a third service a package-writing job and made the model lists go stale the day they were committed.

The snapshots were the part JJ named. `SHIPPED_MODELS` in `gen-fal` carried 23 model ids; a model fal published afterwards could not be used until the app was rebuilt, and a person reading the Video picker had no way to tell a compiled-in list from a fetched one.

The two backends also registered statically, so what the app could offer was fixed at composition time even though `GenerationRuntime.register()` has always returned a disposer.

## Decision

Split the wire protocol, which is code, from the service, which is data.

**Two adapters, parameterised.** `createQueueBackend` (enqueue, poll, download) and `createImagesBackend` (inline response) live in `packages/idealize/services/src/adapters/`. Each takes its id, name, addresses, timeouts, credential and key resolver as options. fal's `authorization: Key <token>` scheme is one of those options, because sending a bare bearer token there answers 401 — the exact failure JJ hit on 3 Sep — and it was a branch in code until it became a field.

**One directory row per service.** `MEDIA_SERVICES` in `media-directory.ts` holds fal.ai and OpenRouter as data: id, name, which adapter, addresses, credential env, and for a queue service its categories and auth scheme. `applyEndpoints` layers the plugin's `mediaEndpoints` config over the rows and throws on an id the directory does not carry, because a silently ignored override would leave the app talking to the address it was meant to replace.

**One registrar.** `registerMediaServices` builds a backend per row and registers it through `ctx.effect()`, keyed or not. An unkeyed service still has to appear in the Add list and still has to tell the space launcher what it makes, so `BackendCredentialState` gained `artefacts`, filled from the backend's own `describe()` rather than derived from a fetched catalogue.

**Catalogues are cached, never compiled.** Each backend fetches on mount and every `catalogueRefreshMinutes`, then writes what it got to `<home>/service-catalogues/<id>.json`. The next start reads that file, so an offline or keyless boot offers the models the person saw last time. An unreadable or truncated cache counts as no cache.

`@idealize/gen-fal` and `@idealize/gen-openrouter` are deleted, and their two bundle rows are replaced by the single `idealize-services` row.

## Consequences

Adding a queue-shaped or inline-images-shaped service is now a row in one table. A service answering on a third wire shape still needs an adapter written, and the README says so: the table removes the per-service package, not the per-protocol code.

A genuinely first run, with no key and no network, offers no models for a service until one fetch succeeds. That is the price of deleting the snapshots, and it is honest where a stale compiled list was not.

Stored `FAL_KEY` and `OPENROUTER_API_KEY` credentials keep resolving: the directory rows name the same envs, so JJ re-enters nothing.

`bundle-idealize` mounts one row where it mounted two. The Services list reads `artefacts` from `describe()`, so a service states what it makes before anyone has given it a key, which is when the person is deciding whether to.

## Alternatives considered

**Keep the packages and share a base class.** It removes the duplicated protocol code and none of the real problem: the service would still be a package, its catalogue would still be compiled in, and mounting a new one would still be a composition change.

**Express the protocol as configuration too.** A mini-language for enqueue-poll-download would be harder to read than the 200 lines it replaces, and there is no third shape to generalise from. The chat side already settled this the same way: `PROTOCOLS` in `llm-pi-ai` holds exactly three adapters in code.

**Fetch the catalogue on demand instead of caching.** Every picker open would wait on a network call, and a rate-limited service (fal answers 429 on its keyless listing) would show an empty list with no explanation.
