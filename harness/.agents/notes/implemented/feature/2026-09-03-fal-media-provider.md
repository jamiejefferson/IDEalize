# Agent Note: fal.ai as a built-in media provider, keyed from the Brains pane

Status: implemented

Item 6 of `.idealize/plans/feedback-wave-e-plan.md` (JJ, 3 Sep 2026): a fal.ai key pasted into the custom-provider card failed with "answered 401; check the API key", and JJ hoped the flow could be simpler.

## Problem

The custom-provider card adds a chat provider: it reads `<baseUrl>/models` with `Authorization: Bearer` and expects an OpenAI-style catalogue. fal answers its listing keyless with 200 and refuses a Bearer header with 401 (it wants `Authorization: Key`), and its catalogue is media (text-to-image, image-to-video, text-to-video, text-to-audio), so even a working listing would have offered no chat model. The Motion space had no backend at all: OpenRouter's catalogue outputs no video.

## Decision

- **`@idealize/gen-fal` is a generation backend beside OpenRouter**, registered with `ctx.generation` as `fal`. Every artefact runs through fal's queue API (enqueue with `Authorization: Key`, poll `status_url`, read `response_url`, download each result `url`, keep files of the requested artefact). The catalogue ships the first rows of the `text-to-image`, `text-to-video` and `text-to-audio` pages and refreshes one keyless page of 100 per category (fal rate-limits the keyless listing; paging the whole catalogue answered 429 within seconds). fal is the first backend serving the Motion preset.
- **The key is pasted once under Brains › Models › Media keys.** The seam grew a declaration: a backend may carry `credential: {displayName, env}`; `ctx.generation.credentials()` lists such backends with `connected`, `refreshBackend(id)` re-reads one catalogue. `@idealize/generate` mounts `GET/POST /idealize/brains/media-keys` (loopback, mutation needs `x-idealize-auth`): POST stores the key as the `env` credential through `ctx.credentials` (empty removes it) and refreshes the backend. The Brains pane lists each such backend with Connected / Key missing, an inline password field, and re-reads the media pickers after a save. OpenRouter keeps its existing path (its key is a chat provider's, stored by the provider editor or onboarding) and declares no `credential`.
- **The seam's availability stays about compatible models.** Shipped fal endpoints are selectable before a key exists, and a generation without one fails `MISSING_CREDENTIAL`; the key's absence is the media-keys route's news. This matches OpenRouter's shipped images.
- **The custom-provider 401 message names the scheme** (`packages/llm/llm-pi-ai/src/discovery.ts`, logged in FORK.md): "check the API key (sent as a Bearer token; a provider wanting another scheme refuses it)".

## Alternatives considered

- Teaching the custom-provider card fal's auth scheme: fal still lists no chat model, so the card would connect and offer nothing.
- Storing the fal key through the provider editor: that editor binds llm-pi-ai provider routes; a media backend is not one.
- Paging fal's whole catalogue on refresh: the keyless limit made that a multi-minute crawl; one page per category is what a picker needs.
- Listing `text-to-speech` too: those endpoints take `text`, not `prompt`; deferred until the Sound Stage wants voices.

## Consequences

- New package `packages/idealize/gen-fal` (row `idealize-gen-fal` in the bundle patch; config `apiKeyEnv`, `baseUrl`, `queueUrl`, `catalogueRefreshMinutes`, `requestTimeoutMs`, `pollIntervalMs`); `@idealize/generate` depends on `@deepseek-ai/dsh-credentials`.
- `GenerationBackend.credential?`, `BackendCredential`, `BackendCredentialState`, `GenerationKeyQueries` are new seam exports; `BackendCredentialState` is exempted in `gen-cordis-catalog`.
- No real-API smoke has run: the queue flow is proven against a fake fal on loopback (`tests/plugin-lifecycle.host.spec.ts`). The first generation with a real key is the smoke; `duration` and `aspect_ratio` are fal's common vocabulary, and an endpoint refusing a field answers 422 whose reason reaches the model.
- The desktop vendors `idealize-gen-fal-1.0.0-dev.0.tgz`.
