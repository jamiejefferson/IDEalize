# @idealize/generate

The generation capability seam. `ctx.generation` is a registry of generation backends (image, video, audio) plus compatibility-checked dispatch: mode code and presets state capabilities, stored provider configuration names models, and adapters translate providers. Registering a backend whose catalogue matches a preset makes its models selectable with no mode-code change; removing the last one produces a queryable unavailable state with a recovery action.

## Service (`ctx.generation`)

| Method | Behaviour |
|---|---|
| `register(backend)` | Adds a `{id, credential?, describe, models, refresh?, inputs?, generate}` backend. Duplicate ids throw. Returns the disposer; the registration is an effect disposed with the calling fiber. |
| `backends()` / `catalog()` | Registered ids; the merged `{backend, model}` catalogue. |
| `credentials()` / `refreshBackend(id)` | The backends declaring a `credential` (`{displayName, env}`: the key the person pastes under Brains), each `connected` while none of its descriptors reads `no-credential`; re-fetch one backend's catalogue after its key changed (false when no backend has that id). |
| `compatible(requirements)` | Catalogue rows whose model satisfies every requirement: artefact matches and required input modalities ⊆ the model's (`satisfies` / `satisfiesAll`, exported pure). |
| `availability(requirements)` | `{state:'available', backends, models}`, or `{state:'unavailable', reason: 'no-backend' \| 'no-compatible-model', recovery, keyMissing?}` with a user-actionable recovery sentence; `keyMissing` (on `no-compatible-model`) is true when no registered backend holds a credential, and false when connected backends offer nothing for the artefact, which no key can change. |
| `inputs({backend, model})` | The inputs a person may choose for one model before generating, from the backend's optional `inputs(modelId)`: `GenInputField[]`, a union on `kind`: `{kind: 'enum', values, default?}`, `{kind: 'number', integer, min?, max?, default?}` or `{kind: 'boolean', default?}`, each with the `name` of the wire property the chosen value travels under in `GenerationRequest.settings` and a display `label`. Plain string inputs, the prompt and the provider's internal fields are excluded by the backend. Empty when no backend has that id or the backend publishes no schema; rejects when the backend's schema fetch fails. |
| `generate(request, onProgress?, signal?)` | Validates the backend, the model id, and compatibility (`NO_ADAPTER` / `NO_MODEL` / `INCOMPATIBLE_MODEL`), then dispatches. Non-GenerationError backend failures are wrapped as `PROVIDER_ERROR` with the cause chained. |

`GenerationError` extends `HarnessError` with the closed code union `INVALID_CREDENTIAL | MISSING_CREDENTIAL | AUTH | RATE_LIMIT | QUOTA | NO_ADAPTER | NO_MODEL | INCOMPATIBLE_MODEL | INVALID_REQUEST | TIMEOUT | ABORTED | PROVIDER_ERROR`, mirroring the LlmError taxonomy. Route on `error.code`, never on the message.

Requests, results, and capability descriptors carry `schemaVersion` (`GENERATION_SCHEMA_VERSION = 1`).

## Media presets

`MEDIA_PRESETS` declares the three default media presets in code — Images (`generate-image`, artefact `image`), Motion (`generate-video`, artefact `video`), Sound (`generate-audio`, artefact `audio`) — each with `taskIntent`, `requiredCapabilities`, and `artefactType`. The definitions contain capability identifiers only; the user's chosen model per preset is stored in the settings document alone, in the `models` map of the `idealize-activity-pills` section (the same map that stores the activity agents' model choices), as `{provider: <backend id>, model: <model id>}`. The Brains pane therefore reads one preset→model roster; this package restates that section's namespace and a narrow face the way `@idealize/models` restates the `llm-pi-ai` section.

## Routes (loopback; the mutations need `x-idealize-auth: 1`)

- `GET /idealize/brains/media` → `{ presets }`: per preset the definition, the stored `model` (`{backend, model}` or null), `candidates` (the compatibility-filtered catalogue), and `availability`.
- `POST /idealize/brains/media` `{ id, model }` → stores one preset's choice; `model: null` clears it. A model outside the preset's compatible candidates is refused with a 400. Answers 503 while the `idealize-activity-pills` settings section is not registered.
- `GET /idealize/brains/media-keys` → `{ providers }`: one `{backend, displayName, env, connected}` per backend declaring a `credential`, in registration order.
- `GET /idealize/generate/inputs?space=gallery|soundstage|motion` → `{ model, fields }`: the space's chosen media model as `{provider, model}` (null while none is stored; `presetIdForSpace` maps the space to the preset the choice is stored under, and accepts the preset ids `images`, `sound`, `motion` too) and the model's `GenInputField[]`. `fields` is `[]` when no model is chosen, when the backend publishes no schema, and when the schema fetch fails, in which last case the failure is logged as a warning so the composer still renders. A space that does not generate is refused with a 400.
- `POST /idealize/brains/media-keys` `{ backend, apiKey }` → stores the trimmed key as that backend's `env` credential through `ctx.credentials` (an empty key removes it), refreshes the backend's catalogue, and answers `{ ok, backend, connected }`; a refresh that fails still answers 200 with its message under `refresh`, since the key is stored either way. An unknown backend or a key with a character outside printable ASCII is refused with a 400.

The media and inputs routes mount while a web server and settings service are composed beside the service; the media-keys route while a web server and credential store are.

## Model Experience

Indirectly, through the `generate_*` tools of `@idealize/gen-tools`, which call `ctx.generation.generate` and render the outcome; the seam, the media presets and the routes register nothing model-facing of their own.

#### KV Cache effect

Independent: dispatch produces no chat request, and the recovery sentences the seam publishes reach the model only inside a tool result, which is append-only after the reusable prefix.

## Known Limitations and Deferred Work

- **No artefact persistence** — results return base64 outputs to the caller; the shared artefact engine (MOD-03) lands in a later slice, so nothing stores or addresses outputs across modes yet.
- **The Brains-pane picker UI is not here** — the routes serve the data; the filtered pickers land with the Brains pane slice in `@idealize/ui-bar`.
- **The media and media-keys route handlers are exercised through their pure helpers** (`mediaPresetStates`, `parseMediaSelection`, `applyMediaSelection`), not through a booted web server; only the inputs route runs against a real loopback server in `tests/routes.spec.ts`.
- **A plain string input is not offered.** A free-text property other than the prompt (a negative prompt, a system prompt) has no control in the composer; the model may still set it through the tool's `options`.
