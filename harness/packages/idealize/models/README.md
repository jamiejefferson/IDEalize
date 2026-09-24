# @idealize/models

Model management for IDEalize, host half only: the loopback routes behind the Time & cost pane and the Brains pane's Models tab (usage, working time, prices, the provider directory named through `@idealize/services`), the `/idealize/models` HTML panel, and the auto-selection policy that keeps the deployment default model pointed at the best usable route. Mounted by the `idealize` profile as the `idealize-models` row. The default model itself is `@deepseek-ai/dsh-agent-default-model`'s settings section; this package reads and writes that section and owns nothing of the request path.

## Configuration and settings (`idealize-models`)

The row's config is also a settings section, so the panel's edits persist in the settings document over the composition value.

| Field | Default | Meaning |
|---|---|---|
| `cost` | `34` | Preference weight, 0 to 100, relative to the other two. |
| `speed` | `33` | Preference weight. |
| `intelligence` | `33` | Preference weight. |
| `mode` | `manual` | `manual` leaves the default model alone; `auto` lets the policy write it. |
| `monthlyTokenBudget` | `0` | Tokens per calendar month the Budget tab measures against; 0 means no budget. |
| `currency` | `USD` | ISO 4217 code the Budget tab's costs are shown in; token prices and plan costs are entered in this currency. |
| `tokenPrices` | `{}` | Token prices per provider then model, in currency units per million tokens, all four kinds explicit (`input`, `output`, `cacheRead`, `cacheWrite`). |
| `subscriptionCosts` | `{}` | Monthly plan cost per subscription provider (`monthly`, optional `since` as `YYYY-MM` starting the year-to-date count part-way through the year). |
| `openRouterPriceRefreshMinutes` | `1440` | How long a cached OpenRouter price list is trusted before the usage route re-reads OpenRouter's model directory; `0` never fetches. |
| `falUsageRefreshMinutes` | `1440` | How long a cached fal usage report is trusted before the usage route re-reads fal's `/v1/models/usage`; `0` never fetches. |

## Cost

`src/pricing.ts` turns the usage fold's per-route token detail into money using only known prices: metered (API-key) tokens bill at their model's price, every configured subscription plan bills its `monthly` cost whether or not it saw usage (year to date counts from January, or from `since`), and free-route work costs nothing out of pocket. Nothing is estimated: a metered route without a price is reported as unpriced tokens and as a row without a `cost`, a signed-in subscription without a plan cost is named in `unpricedSubscriptions`, and until any price or plan cost is known the payload says `configured: false` so the Time & cost pane shows a hint instead of zeros. `modelRows` lists every model with usage in the month, by token total, with its cost and the source-marked price behind it where one exists.

Prices come from three sources, merged by `effectivePrices` in `src/prices.ts` and marked with the source that supplied each figure. The lowest is the model catalogue the app ships: `shippedTokenPrices` in `@idealize/services` reads pi-ai's published per-model `cost` for every chat route the `llm-pi-ai` settings section holds a profile for, and marks those figures `catalogue`. OpenRouter's published directory lays over it for the `openrouter` route: while that route has a stored key and `currency` is `USD`, the usage route reads OpenRouter's `/api/v1/models` directory (`pricing.prompt` and `pricing.completion` in USD per token, scaled to per million; `input_cache_read` and `input_cache_write` where published, else the prompt price, which is what a model with no cache discount charges), caches it at `<home>/service-catalogues/openrouter-prices.json` with its `fetchedAt`, and marks those figures `market` — the tag names the kind of source, not the provider, so a pane can say where a price came from without hard-naming a backend (the mode/provider boundary, AC-03) — and re-reads it after `openRouterPriceRefreshMinutes`. `tokenPrices` — what the person typed, through the Brains pane's price editor or the settings document — wins over both. A failed OpenRouter fetch keeps the last cache. Catalogue prices apply only while `currency` is `USD`, the currency pi-ai publishes them in, and a model no source prices stays unpriced.

## Generations

`src/generations.ts` covers the spend the token prices miss. A media service bills per unit it generates, and its report carries no token counts, so two folds meet in the usage route. The local one counts `artefact/created` events per `provenance.provider` and `provenance.model` for the month and the year to date, so the table lists what was made whether or not any service reports a bill. The billed one is fal's own report: with a key stored for the `fal` media backend (the credential `@idealize/services` registers it with), the route reads `GET https://api.fal.ai/v1/models/usage` with `Authorization: Key <key>`, `timeframe=month` and `expand=time_series`, follows `next_cursor` to the end, and files each bucket's `endpoint_id` / `unit` / `quantity` / `cost_total` / `currency` under its calendar month. The report is cached at `<home>/service-catalogues/fal-usage.json` with its `fetchedAt` and re-read after `falUsageRefreshMinutes`.

Nothing here prices a generation itself. An endpoint fal has not billed carries a count and no figure. A failed read is reported as fal's own message, with the last report still standing, and a currency shown is always the one fal sent.

## The auto policy

`choose` (`src/policy.ts`) is a pure decision over the weights and three live facts: the free-tokens engine's route, health and usable-key count (read from the `llm-pi-ai` settings section and the engine's own API when `@idealize/freetokens` provisioned it), the OAuth providers with stored credentials (`ctx.idealizeOAuth`), and the live model ids per provider from `ctx.llm`. The dominant weight orders the tiers: cost or speed puts free tokens first, intelligence puts the ChatGPT subscription (`openai-codex`) first; ties resolve towards cost. On the subscription the flagship is read from an ordered list (`gpt-6-astra`, then `gpt-5.5`) because the route's ids carry no ordering of their own, and a route with neither falls back to its first non-mini id; when speed leads, a `-mini` of the flagship is taken where one exists, else any mini on the route. The first tier whose facts read as usable wins, and the policy never routes to a provider it cannot verify credentials for. In `auto` mode the evaluation runs at once and then every 180 seconds, writing the choice into the agent-default-model section; a chat pinned to a model keeps it, so the default steers new chats and unpinned scheduled runs only.

## Routes (loopback only; mutations need `x-idealize-auth: 1`)

- `GET /idealize/models` renders the HTML panel (`src/models-page.ts`).
- `GET /idealize/models/state` returns providers and models (`displayName` resolved through `@idealize/services`' `serviceName`, so a catalogue route reads as its company; `catalogue` says whether the list is the app's `built-in` catalogue or the route's own `configured` one), `readAt`, the current default, the mode, the last auto verdict, the preference weights, and per-provider `auth` and `connected` flags.
- `POST /idealize/models/default` `{provider, model}` writes the default and switches `mode` to `manual`.
- `POST /idealize/models/mode` `{mode}`; `auto` evaluates immediately.
- `POST /idealize/models/preferences` `{cost, speed, intelligence}`.
- `GET /idealize/models/work` returns `projects` (one row per registered project: `path`, `label`, `time` as whole seconds for `today`, `month` and `all`, `cost.month` — what its metered tokens cost at the known prices — and `tokens.month`), `totals` (the same over every log, with `cost.plans` naming the subscription plan share of `cost.month`), `currency` and `costConfigured`. `src/worktime.ts` folds each log's `turn/start` / `turn/end` pairs into spans (a turn still open counts to now), unions a project's chats' spans so two chats answering at once count once, and bridges pauses under five minutes, on the host machine's local calendar. A log belongs to the project whose registry entry claims its session id or whose path is its working directory; an unclaimed log counts in the totals alone.
- `GET /idealize/models/usage?scope=<project path>` returns month-to-date and year-to-date tokens per billing category (`subscriptions`, `metered`, `free`; `src/usage.ts` folds every `assistant/message` event's reported usage by the answering provider and model), the project list, the budget, the `cost` breakdown `src/pricing.ts` computes from the effective prices, `models` (one row per model with usage this month, with `cost` and its source-marked `price` where one exists), `openRouterPrices` (`fetchedAt` and the model count of the cached OpenRouter list, or `null`), `generations` (`rows` — one per endpoint that generated this month, each with its `count`, `mediaType` and fal's `billed` line where fal reported one — plus the per-currency `billed` totals for the month and the year, and the `currency` fal billed in or `null`), and `falUsage` (`fetchedAt` and any `error` text, or `null` when no fal key is stored). Without `scope` every session is folded.
- `POST /idealize/models/budget` `{monthlyTokenBudget}`; 0 clears it.
- `POST /idealize/models/prices` `{provider, model, price}` stores one model's `tokenPrices` entry; `price` carries all four kinds as non-negative numbers per million (`parsePriceBody` refuses a missing kind rather than reading it as free), or `null` to clear the entry.

## Model Experience

Indirectly, through the default-model selection this package writes into `dsh-agent-default-model`'s settings section; request assembly and the provider adapters own the model-visible request.

#### KV Cache effect

An auto-mode switch of the default model starts new chats and unpinned scheduled runs on another route, so their requests share no cache with sessions on the previous default; a chat pinned to a model keeps its provider and its cache. Nothing here changes the content of any request.

## Known Limitations and Deferred Work

- **The panel is a host-rendered HTML page, not a client-slot pane.** `/idealize/models` is the working draft of the in-app models surface; the Brains pane in `@idealize/ui-bar` covers usage and the free-token engine, and its Time & cost pane the budget, while the harness's own cost / speed / intelligence weights are edited on this page only.
- **The policy routes only to free tokens or the ChatGPT subscription.** Paid keyed routes are never chosen automatically because the policy will not route to a provider whose credentials it cannot verify; a keyed default has to be set by hand, which also drops `mode` back to `manual`.
- **Usage is folded from session logs on every request.** `GET /idealize/models/usage` walks every live agent and persisted log per call; there is no cached total, so the Time & cost pane's cost grows with the session count; `GET /idealize/models/work` walks them the same way.
- **Only OpenRouter prices itself live.** Every other metered route is priced by the shipped catalogue or the person's entry; a service that publishes prices in a directory the app already reads could price itself the same way. Both OpenRouter's prices and the catalogue's apply only while `currency` is `USD`, because that is the currency they are published in.
- **Only fal reports what a generation cost.** Every other media backend contributes a count and no figure, and there is no price editor for a generation endpoint, so an unbilled row stays unbilled rather than taking a typed rate.
- **A price change reprices the whole month.** Prices are current figures, not dated ones: an OpenRouter refresh or a typed change applies to every token this month, and history is never repriced from a stored table because none is stored.
