# Agent Note: Generation capability seam + OpenRouter adapter

Status: implemented

## Problem

IDEalize V1's Gallery and Sound Stage need media generation routed by capability (spec §5.3 BRN-01..09): presets state task intent and required capabilities, stored configuration names models, and adapters own provider behaviour, so a changed model catalogue never changes mode code. Nothing in the tree offered a generation seam, an OpenRouter media adapter, or the Images/Motion/Sound presets.

## Decision

**`@idealize/generate` is the seam package.** `GenerationRuntime` (`ctx.generation`, WebRuntime-shaped) registers `{id, describe(): CapabilityDescriptor[], models(): GenModelInfo[], refresh?, generate}` backends through the register-returns-disposer effect rule. The compatibility rule is one exported predicate: artefact matches and required input modalities ⊆ the model's. `availability(requirements)` is the queryable BRN-09 state — `no-backend` or `no-compatible-model`, each with a recovery sentence. `GenerationError extends HarnessError` with a closed code union mirroring the LlmError taxonomy plus seam routing codes; backends translate every provider failure into it (BRN-06).

**Media presets live in `@idealize/generate`, their model choices in the activity-pills settings map.** JJ's revision: one default preset roster — the activity agents (coding/design/writing/admin) plus images/motion/sound — each media preset declaring `{taskIntent, requiredCapabilities, artefactType}` in code and storing only its chosen model in settings (AC-14). The definitions could not live in `@idealize/activity-pills` itself: that package registers in the Client aggregate, cross-package `@idealize` imports are type-only by precedent, and no `@idealize` tsconfig paths existed, so a host-face runtime import of it would break the source-plane rule. Instead the choices persist as more keys of the `idealize-activity-pills` section's `models` map (`{provider: <backend id>, model: <model id>}`), the namespace and a narrow face restated exactly as `@idealize/models` restates the `llm-pi-ai` section. `GET/POST /idealize/brains/media` serves the preset roster with compatibility-filtered candidates and stores choices; a choice outside the candidates is refused.

**`@idealize/gen-openrouter` registers backend `openrouter`.** Images run through the vendored pi-ai `openrouter-images` provider (its static catalogue is the shipped image default); audio/video run through `/chat/completions` with `modalities`, outputs read from `message.audio.data` and `message.images[]` data URLs. The live keyless `/models` list, filtered by `architecture.output_modalities` and typed by the richest media modality, merges over shipped defaults on mount and on a timer (BRN-08). Keys resolve per operation via `ctx.credentials` from `OPENROUTER_API_KEY`. Catalogue reality at packaging: 419 live rows — 11 image-output, 4 audio-output, 0 video-output — so Motion stays unavailable until a video route or another adapter appears.

**`@idealize/gen-fixture` proves AC-13 keylessly**: a configurable in-memory backend whose models become selectable through `compatible()`/`mediaPresetStates` with zero mode-code change, and whose scope disposal flips availability to the unavailable state (the AC-15 path).

New `@idealize/*` paths entries in `tsconfig.base.json` make these the first idealize packages with source-plane cross-imports; gen-openrouter and gen-fixture import `@idealize/generate` values at runtime.

## Alternatives considered

**Defining the media presets in `@idealize/activity-pills`.** Rejected for the aggregate/face conflict above; the settings map is still the shared store, so the Brains pane reads one roster.

**One settings section per media preset in `@idealize/generate`.** Rejected: it would split the preset→model roster across two namespaces for no consumer.

**Hard-scoping the adapter to image models.** Rejected per JJ's revision: the adapter surfaces whatever the catalogue offers by output modality, so sound (and future video) routes appear without code changes.

## Consequences

Slices that land Gallery/Sound Stage submit `GenerationRequest`s through `ctx.generation` and read candidates from `/idealize/brains/media`; the Brains-pane pickers (later slice, `@idealize/ui-bar`) consume the same route. The artefact engine (MOD-03) is still absent: results return base64 outputs to the caller. Route handlers are covered through their pure helpers, not a booted web server; the assembled-application snapshot for the media routes is deferred with the pane slice.
