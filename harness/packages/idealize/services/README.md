# @idealize/services

One list of every service IDEalize can connect, and one way to connect them. A person adding fal.ai or Anthropic holds two facts: the company's name, and an API key. They do not hold an endpoint, a wire protocol or a route id — and the surface that asked for those is why adding a service was hard (JJ, 4 Sep 2026: "the 'base url' thing is something that I and others will struggle with").

## The list

`GET /idealize/brains/services` serves one array joining two registries that the app already keeps:

- **Chat routes** from `ctx.llm.listConfigurableProviders()`, each connected while its credential resolves. A route the LLM directory offers through OAuth sign-in and that holds no key is left out: it is connected under Subscriptions, where signing in happens, and listing it here would show one account twice and offer it a key it does not take. A route holding a key stays listed whether or not sign-in is also on offer; one whose only auth is sign-in (the OAuth face's `keyless` rows) is marked `signIn`, so the route refuses a new key for it and an empty key removes a stray one. Removing any chat key also drops the `apiKeyEnv` this plugin recorded for the route, so nothing reads it as keyed afterwards (14 Sep 2026: a value stored under `OPENAI_CODEX_API_KEY` was sent as a ChatGPT token and every turn on the route failed).
- **Generation backends** from `ctx.generation.credentials()`, each saying what it makes — `image`, `video`, `audio` — read from the backend's own `describe()`. A service says what it makes before anyone has given it a key, because that is when the person is deciding whether to.

Rows carry `{id, kind, name, makes, connected}` plus `keyUrl` where the service's key page is known. Connected rows sort first, then by name. Nothing is ranked by how much the app would like a service used.

A company selling both chat and media stays two rows: the two keys live in different places and either can be connected without the other, so one row would have to lie about what connecting it did.

## Connecting

`POST /idealize/brains/services {id, kind, apiKey}` stores the key where that kind of service keeps it, so the caller never has to know:

- **media** — under the credential name the backend itself declares (`BackendCredential.env`), then re-reads that backend's catalogue so its models are selectable at once. A catalogue that cannot be re-read leaves the last-known models standing and retries on the adapter's own timer.
- **chat** — under `<ROUTE>_API_KEY`, the same derivation the models page uses (`deriveKeyRef` in `dsh-client-ui-settings-models`), so a key pasted on either surface reaches the same credential. The profile's `apiKeyEnv` is recorded in the `llm-pi-ai` settings section in the same call, because a dormant route stays dormant until its profile names the credential: the key alone would connect nothing.

An empty key removes a stored one. The route answers with the refreshed list, so the caller re-renders from the host rather than guessing.

### A keys file connects several at once

`POST /idealize/brains/services/import` takes a keys file as its body: `{"format": 1, "credentials": {"ANTHROPIC_API_KEY": "…", "OPENROUTER_API_KEY": "…", "FAL_KEY": "…"}}`. It is how an organisation hands its keys to a person: the desktop app opens a `.idealizekeys` file on double-click and posts it here, and the Brains pane's "Import a keys file…" link does the same for a file already on disk. Each credential name is matched to the service that takes it — the chat route whose `<ROUTE>_API_KEY` it is, else the generation backend declaring it — and stored exactly as a pasted key would be, `apiKeyEnv` recorded for a chat route and the catalogue re-read for a media one. The answer carries `connected`, the rows connected in file order, and the refreshed list. `format` is `1` (`KEYS_FILE_FORMAT`); a file may carry at most 64 credentials, each named by a POSIX environment name and holding a printable-ASCII key. Any other member of the file is ignored, so an issuer may note who made it and when.

Every name is matched before anything is stored, and a name no service takes refuses the whole file (400) naming it, so a person is never left with half a file connected and no way to tell which half. A store refusal partway (409, the environment already supplying a key) names the service and lists what connected before it.

All three are loopback-fenced; the mutations demand `x-idealize-auth: 1`.

### Refusals name what to do

A write the launching environment would shadow answers **409** carrying the store's own reason ("supplied read-only by the launching environment"), not a generic key failure — the person's key is fine and their shell is the author, so sending them back to their clipboard would waste the trip. An unknown service, a key carrying characters an API key cannot hold, and a service declaring no key each answer 400 naming the fault.

## The media services

This package registers the generation backends too, one per row of `MEDIA_SERVICES` in `src/media-directory.ts`. A row holds the service's id and name, the wire shape it answers on, its addresses, the credential its key is stored under, and for a queue service the categories to list and how the key is presented on the wire. fal.ai wants `authorization: Key <token>` where OpenRouter wants a bearer token, which is why the scheme is data rather than a branch in code.

Two adapters cover both known shapes. `createQueueBackend` enqueues a job, polls it and downloads the results; `createImagesBackend` asks for the image inline. A service answering on a third shape needs a third adapter, and that is the real cost of adding one: the table removes the per-service package, not the per-protocol code.

### A required field the request did not carry

Some fal endpoints require a field beside `prompt` that the generation seam never sets. `minimax/music-3` requires `lyrics`, and a Sound Stage prompt with no lyrics answered `422: lyrics: Field required` until 7 Sep 2026. When an enqueue answers 422, the queue adapter reads fal's validation list, and if every `Field required` entry names a field absent from the sent body and present in `REQUIRED_FIELD_DEFAULTS` (`src/adapters/queue-api.ts`, today `lyrics: '[instrumental]'`, the structure tag fal's music endpoints use for a track with no words), it enqueues once more with those fields filled and carries on. A 422 naming a field with no default, one refusing a value the body already carried, or a second 422 after the retry is the refusal it reads as, with fal's reason in the message. The defaults are fal's wire vocabulary and live beside the wire code; they are not configuration.

### A reference image goes to the image-to-video sibling

fal publishes each video family as sibling endpoints, `…/text-to-video` and `…/image-to-video` (Seedance, Kling and the rest), and only the image-conditioned one takes `image_url`. When a request carries an image attachment (the generation tools' `reference_image`) and the chosen model's id ends in `text-to-video`, `endpointFor` in `src/adapters/queue-api.ts` enqueues on the `image-to-video` sibling, reads that endpoint's input schema for the coercion, and sends the attachment as a base64 `image_url` data URL. A model whose id is not named that way (`fal-ai/veo3.1`) receives the `image_url` on its own endpoint. The rule is fal's naming, kept beside the wire code with its test; a service that names its siblings differently needs its own rule.

### The model's own inputs, and the types it wants them in

A fal endpoint states what it takes in an OpenAPI document published per endpoint (`inputSchemaUrl` on the directory row, `{id}` standing for the endpoint id). `createQueueBackend.inputs(modelId)` reads that document the first time a model is asked about or generated with, keeps the parsed schema in memory, and writes it through the registrar to `<home>/service-catalogues/<service>/inputs/<endpoint id with / as __>.json`, so the next start reads the file and asks the network for nothing. `src/adapters/input-schema.ts` is the pure part: `parseInputSchema` finds the `*Input` schema, reads each property's type, enum, default and requiredness in `x-fal-order-properties` order, and looks through fal's `anyOf: [{type: 'string', enum}, {type: 'null'}]` wrapper to the typed branch; `inputFieldsFrom` projects the string enums outside `EXCLUDED_INPUTS` (the prompt, `image_url`, `negative_prompt`, `seed`, and the provider's plumbing: `enable_safety_checker`, `safety_tolerance`, `sync_mode`, `output_format`, `system_prompt`, `limit_generations`, `enable_web_search`, `num_images`, `num_inference_steps`, `guidance_scale`) into `GenInputField`s labelled `Aspect`, `Duration`, `Resolution`, or the wire name with underscores as spaces and a capital first letter. A property with no enum (a plain-number `duration`) yields no field.

The same schema types the body. `duration_s: 5` reached fal as `duration: 5` and seedance answered `422: duration: Input should be '4', '5', … or '12'` on 7 Sep 2026, because its duration is a string enum. Before each enqueue, `coerceBody` coerces every field the schema names: a value for an enum becomes the literal `coerceLiteral` picks (the value itself when it is a literal, its string form when that is, otherwise the numeric literal nearest to a numeric value, so `7.5` reads as `"8"`, a tie taking the larger), a string for a numeric field becomes a number (rounded for an integer), `"true"`/`"false"` for a boolean field becomes the boolean, and a number for a plain string field becomes its text. A number for a plain-number field is left alone. Fields the schema does not name pass through, and a value nothing fits is sent as it is, so fal's 422 names it. When no schema is known (the service refused the document, or the row has no `inputSchemaUrl`), the body goes out as built and a 422 whose entries read `Input should be 'a', 'b' or 'c'` for a field the body carries is answered once with the coerced literal, alongside the required-field retry above; a second 422 is the refusal. A schema that cannot be read never stops a generation.

Backends register whether or not a key resolves. An unkeyed service still has to appear in the Add list, and the space launcher still has to know what it makes. `describe()` reports whether the key resolved, and connecting one re-reads its catalogue immediately, so pasting a key makes the models selectable without a restart.

### Catalogues are read, never compiled in

No model list ships in this package. Each backend fetches its own catalogue on mount and every `catalogueRefreshMinutes` after, and writes what it got to `<home>/service-catalogues/<id>.json`. The next start reads that file, so a keyless or offline boot still offers the models the person saw last time. Until 4 Sep 2026 the two adapter packages carried snapshots of their vendors' catalogues in TypeScript: they went stale the day they were written and a new model could not be used until the app was rebuilt.

A cache that cannot be read or parsed counts as no cache; the next fetch replaces it.

## The names, and the key pages

Two tables in `src/directory.ts` are the only data this package carries.

`SERVICE_NAMES` is what each service calls itself. The LLM directory hands a catalogue route its own id as its display name (`declare(provider, provider)` in `llm-pi-ai`), so without this the list would read "openai" and "moonshotai" — labels belonging to the configuration file, not to the company the person holds an account with. A route absent from the table keeps its id, which is honest: it is what the app knows the route as; `join.spec.ts` holds the table to every route the installed catalogue ships, so a pi-ai upgrade that adds routes cannot leave them reading as ids. A name the registry genuinely supplied always wins.

`KEY_PAGES` is where each known service issues API keys, looked up by route id and then by the display name squeezed to letters and digits. A service absent from it renders its key field with no link. A wrong address is worse than none, so nothing is guessed from the service's name.

## Configuration (`idealize-services` row)

| Key | Default | What it changes |
| --- | --- | --- |
| `requestTimeoutMs` | `600000` | Whole-generation timeout, enqueue to last download. |
| `pollIntervalMs` | `2000` | Milliseconds between queue status polls. |
| `catalogueRefreshMinutes` | `60` | Minutes between catalogue refreshes; `0` refreshes once on mount. |
| `mediaEndpoints` | `{}` | Where a service is reached, by directory id: `{fal: {baseUrl, queueUrl}}`. A deployment behind a proxy or on a regional endpoint answers the same wire shapes at a different host. An id the directory does not carry is refused at load, because a silent reading would leave the override doing nothing while the app talked to the address it was meant to replace. |

The list itself needs no entry: it is derived on every read from the registries composed beside it.

## Model Experience

None, as this package serves a settings surface and stores credentials: it contributes nothing to any model request, adds no tool, and writes no session event, and the keys it stores reach models only through the routes and backends that already resolve them.

#### KV Cache effect

None: no prompt content, tool schema, or system-prompt section originates here.

## Known Limitations and Deferred Work

- **A service outside the two registries still needs the web-address route** — this package lists what `ctx.llm` and `ctx.generation` already know. Something neither registry carries reaches the app only through the upstream custom-provider card, which is why the Services section keeps that path as its marked advanced route.
- **`makes` for a chat route is always `chat`** — the LLM directory states no finer capability, so a chat route that also generates images is described by its media row instead.
- **Two wire shapes only** — a media service that answers on neither the queue nor the inline-images shape needs a new adapter written here before its row can be added. Nothing in the table hints at that until the backend fails.
- **An input schema is read once per endpoint per home and never refreshed** — the disk file has no age check, so an endpoint that gains a literal or a field keeps offering the old set until the file is deleted. The catalogue's timer does not touch it.
- **A stale catalogue looks current** — the disk cache carries `fetchedAt`, and nothing shows it. A service offline for a week reads exactly like one refreshed a minute ago.
- **Both tables are hand-kept** — five key pages and thirty-four names today. A service whose key page moves shows a stale link, and a route added to pi-ai's catalogue reads as its id until named; nothing detects either. The packaged landing walk does catch it after the fact: six routes shipped reading as their ids on 4 Sep 2026 (`opencode`, `opencode-go`, the three `xiaomi-token-plan-*` and `zai-coding-cn`) and were named then.
- **The image-to-video substitution is by name only** — a fal video family without an `image-to-video` sibling answers the enqueue with fal's own 404 or 422, which the adapter reports as the refusal it reads as; nothing checks the sibling exists before sending.
- **No verification that a key works** — the route stores what it is given and reports the refreshed list. A wrong-but-well-formed key reads as connected until the first request fails. Probing on connect is a follow-up, and needs a per-service idea of what a cheap probe is.
- **A keys file is plain JSON** — anyone holding the file holds the keys. It travels by a channel that limits who can open it (an organisation's shared drive) and is reissued to rotate a key; the app neither encrypts nor keeps it.
