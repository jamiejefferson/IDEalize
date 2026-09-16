# @idealize/freetokens

The `freetokens` provider route over a FreeLLMAPI sidecar (the fork at `jamiejefferson/idealize-freellmapi`), plus the project attribution header the spend meter rolls up by. The `idealize-freetokens` row of the `idealize` profile bundle mounts it.

## Two modes

- **Embedded**: `sidecarDir` or `serverBundle` is set (the desktop app points `IDEALIZE_FREETOKENS_SERVER` at its shipped single-file server bundle, which fills `serverBundle` when neither is configured). The plugin spawns the forked server on a private loopback port with its own data directory under the Harness home, provisions it hands-free over loopback, stores the credential and registers the provider route. The generated admin password is written twice, to the credentials service under `FREETOKENS_ADMIN_PASSWORD` and to `host-admin.json` inside that data directory, because the sidecar's setup endpoint runs once per database and either store alone can be reset without the other. `SidecarManager` owns the child's lifetime: a crash respawns with backoff, dispose sends SIGTERM. The forked server mounts a static directory unconditionally and defaults it to a dashboard build this app does not ship, so the manager writes one page naming the port into `<dataDir>/port-page` and passes it as `CLIENT_DIST`; every management surface is IDEalize's own, proxied through `/idealize/freetokens/*`. The user's only job is adding upstream provider keys on the status page.
- **Adopt**: no `sidecarDir`. The plugin detects an already-running instance at `baseURL` and registers it with a pasted key through the adopt route.

Registration writes two places: the key goes into the credentials service under `FREETOKENS_API_KEY`, and the settings document's `llm-pi-ai` section gains a hand-declared `freetokens` route (openai-completions at the sidecar's `/v1`) listing the models the sidecar reported. `@idealize/models`' auto policy and the Free activity brain (`@idealize/activity-pills`) select from that route.

## Attribution

`ctx.idealizeAttribution` maps a requesting session to an `x-idealize-project` header (`PROJECT_HEADER`): the session cwd's git toplevel basename, or the cwd basename outside a repository. The fork's `llm-pi-ai` adapter calls `headersFor` per request through its `annotateRequest` seam; the forked server writes the header into `requests.client_label`, which its analytics roll up by label. The header is HTTP metadata and never enters the model's context.

## Routes (loopback; mutations need `x-idealize-auth: 1`)

- `GET /idealize/freetokens` → the status page (sidecar detected, route state, provider keys). `GET /idealize/freetokens/status` → the same facts as JSON.
- `POST /idealize/freetokens/adopt` `{ apiKey }` → verify and register an existing instance.
- `GET /idealize/freetokens/provider-keys`, `POST /idealize/freetokens/provider-key` → the sidecar's upstream provider keys.
- `GET /idealize/freetokens/routing` → the engine's routing strategy, active weight vector (null in priority mode), saved custom vector and per-model score breakdown. `POST /idealize/freetokens/routing/strategy` `{ strategy, weights? }` → one of `priority`, `balanced`, `smartest`, `fastest`, `reliable`, `custom`; `weights` is any non-negative `{ reliability, speed, intelligence }` vector, saved as the custom vector.
- `GET /idealize/spend` → the spend page; `GET /idealize/spend/by-project?range=` → the engine's by-label analytics.

## Configuration (`idealize-freetokens` row)

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `http://127.0.0.1:3001` | The sidecar's origin in adopt mode; `/v1` is appended for the provider route. |
| `sidecarDir` | unset | The fork checkout's `server` directory; set means embedded mode. |
| `serverBundle` | unset (env `IDEALIZE_FREETOKENS_SERVER`) | Absolute path to a single-file server bundle; set means embedded mode. |
| `sidecarPort` | `3213` | Loopback port the embedded sidecar binds. |

## Model Experience

Indirectly, through the `freetokens` provider route it registers in the `llm-pi-ai` settings section, whose adapter owns every model request that route serves.

#### KV Cache effect

Independent: the package adds a route and an HTTP attribution header outside the model's context; which model answers is the engine's routing decision, and a change of model there starts a new prefix under the adapter's ordinary rules.

## Known Limitations and Deferred Work

- **A data directory whose password record and credential are both gone cannot be adopted automatically.** The sidecar's setup endpoint runs once per database, so with no way to log in the host reports the failure and points at `/idealize/freetokens` for manual adoption. `host-admin.json` in the data directory makes this rare: it survives a credential-store reset, and the credential survives a copy of the data directory alone.
- **Embedded mode needs the forked server on disk.** Without `sidecarDir`, `serverBundle` or the desktop env var the plugin can only adopt an instance the user runs themselves.
- **Routing strategy is engine state, not a settings field.** `POST /idealize/freetokens/routing/strategy` writes to the sidecar's own database; a fresh data directory comes back on the engine's default strategy.
- **Attribution shells out to `git` per new session cwd.** A host without `git` on PATH labels every project by directory name; the 3-second timeout bounds a slow filesystem but is not configurable.
