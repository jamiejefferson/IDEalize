# Agent Note: The mode/provider boundary gate and the plugin-architecture acceptance tests

Status: implemented

## Problem

Two of the V1 architecture decisions had no mechanical enforcement. AC-03 asks for an automated test that detects a direct provider call from mode code, and AC-14 for a source check confirming that mode code and the default preset definitions carry capability identifiers while the chosen model ids live in provider configuration. Both were reviewer discipline, which fails the moment a view package needs "just one" model id. AC-01, AC-02 and AC-04 were likewise only implied: `@idealize/gen-fixture` existed and registered through `ctx.generation`, but nothing proved a row in `bundle-idealize/cordis.patch.yml` is the only way a capability arrives, nor that disabling one row takes its contribution with it.

## Decision

**`scripts/verify-mode-provider-boundary.ts` is the AC-03/AC-14 gate, and it runs in `ci-primary`, `ci-static` and `check-all`.** It polices three rules over shipped `src/**` only:

1. No mode package reaches a provider SDK or a Service Provider package, directly or through its declared runtime dependency closure. Walking the closure is what makes the rule hold — re-exporting an adapter through a helper package would otherwise pass — and reading `dependencies` rather than `devDependencies` is what lets a mode's own tests mount an adapter, which is how AC-01 and AC-02 are proven.
2. No mode package and no `MEDIA_PRESETS` declaration carries a model identifier.
3. No mode package hard-names a backend.

**Scope is discovered structurally, not listed.** A mode package is one under `packages/idealize/` that either carries the `ui-` prefix or registers `name: 'conversation.view'` — so a view package added after this gate is policed the day it takes a ring seat. A Service Provider is a package whose code calls `ctx.generation.register`, `ctx.llm.registerAdapter` or `ctx.llm.registerConfigurableProviders`; the receiver is required in that pattern and comment lines are skipped, or the Service Definitions that declare those methods and the JSDoc that documents them would be mistaken for providers. The preset definitions are found by their `MEDIA_PRESETS` export. Empty scope fails the gate rather than passing vacuously.

**The model-id rule fires on three targeted signals, never on the `vendor/model` slug shape alone.** Session event names (`artefact/created`), media types (`image/png`) and module specifiers (`react/jsx-runtime`) all share that shape and are all ordinary mode code — the first draft of this gate reported eleven false positives in `ui-gallery`'s conversation Definition before the rule was narrowed. What fires instead: a first segment in the explicit `MODEL_VENDORS` list, a bare model family (`claude-`, `gpt-`, `flux-`, …), or a literal an adapter package publishes as a catalogue `id:`. The third signal makes the gate follow the adapters, so a model from a vendor nobody listed is still caught once an adapter ships it. Provider ids are matched as whole literals, case-insensitively: `'openrouter'` is a backend selection, `'Add OpenRouter key'` is a sentence a translator owns.

**Every rule is proved to reject before it is trusted to pass.** `scripts/verify-mode-provider-boundary.spec.ts` builds miniature workspaces under a temp root — one per rule, violating and clean — and asserts the exact message. Two further cases check the repository the gate ships against: the discovered scope contains all five V1 view packages, and the real tree reports no violation.

**AC-01, AC-02 and AC-14 are proved on a real Loader composition** in `packages/idealize/gen-fixture/tests/plugin-lifecycle.host.spec.ts`: storage, the settings file, the preset roster, the workspace registry, the web server, the real `idealize-activity-pills` settings section, the artefact store, the generation seam, the Sound Stage host half, and the fixture backend as one row. The same composition boots three ways — the fixture row enabled, `disabled: true`, and absent — so the disabled case is compared against both what it replaces and what its absence looks like. AC-14 is proved by writing a selection through `POST /idealize/brains/media`, reading the model id out of `settings.yaml`, then relaunching over the same file and finding the choice restored: the id lives in the settings document because that is where it survives.

**AC-02 on the view side is proved over the ring itself,** in `packages/idealize/ui-bar/tests/view-plugin-disable.client.spec.tsx`. The Gallery and Sound Stage client plugins mount for real on a real `SlotRegistry`, and the welcome card renders over `MEDIA_MODES` filtered by the bar's own `ringHasView` rather than over a stubbed view list. Disposing the Gallery fiber — what disabling its row does at runtime — drops its ring seat, its composer settings row and its welcome segment together, while Sound Stage and Chat keep theirs.

**AC-04 reads the shipped manifest,** in `packages/idealize/bundle-idealize/tests/plugin-manifest.spec.ts`: every `@idealize/*` package exporting a host plugin appears as an `insert` row or sits in a two-line exemption map with its reason, each row resolves to a versioned workspace package that the bundle declares as a dependency, and each row id is `idealize-<package>`.

## Alternatives considered

**A substring scan for provider names over the UI packages.** Rejected: it matches translated UI prose, every `@deepseek-ai/*` import specifier, and the test fixtures that mount adapters on purpose. The gate would have had to be silenced on its first run, which is how gates die.

**Hardcoding the mode-package and adapter-package lists.** Rejected: the list is exactly the thing a new view package forgets to join. Structural discovery costs one regex per rule and covers the case nobody remembers.

**Testing AC-14 against a stub settings section.** Rejected by the brief and on merit: `POST /idealize/brains/media` returns 503 when the section is unavailable, so a stub would prove the route's own plumbing and nothing about where the id lands. Mounting `@idealize/activity-pills` puts the real schema and the real file under the assertion.

**Asserting AC-02 by disposing the fixture's plugin scope in-process only.** Kept as one case, but the composition also boots with `disabled: true` on the row, because that is the mechanism `@idealize/hatch` gives the user.

## Consequences

The gate's adapter set is currently `@deepseek-ai/dsh-llm-deepseek`, `@deepseek-ai/dsh-llm-pi-ai`, `@deepseek-ai/dsh-llm-replay`, `@idealize/gen-fixture` and `@idealize/gen-openrouter`; its mode set is the five V1 view packages plus `@idealize/ui-tour`, which the `ui-` prefix catches and which has no reason to name a provider. A package that legitimately needs to name a provider must either be an adapter or hold the id in settings — there is no allowlist for a mode package, by design.

`MODEL_VENDORS` will go stale as vendors appear. That is why the catalogue-harvest signal exists, and why the failure mode is a missed literal rather than a false alarm: the gate is tuned to stay silent on honest code, and the adapters' own catalogues carry it forward.

`@idealize/gen-fixture` and `@idealize/ui-bar` gained devDependencies on the packages their new compositions mount (`@idealize/activity-pills`, `@idealize/ui-soundstage`, `@idealize/ui-gallery`, and the storage/settings/session/webserver rows). The boundary gate reads runtime `dependencies` only, so those devDependencies do not cross the boundary it polices — and the "an adapter a mode only names in its tests" case in the gate's spec pins that behaviour.
