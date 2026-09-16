# Agent Note: Generation tools and the media agent presets

Status: implemented

## Problem

The generation seam (`ctx.generation`) and the artefact store landed with no model-facing way to reach either: nothing turned a user's prompt into a stored artefact. AC-06 also requires a Gallery or Sound Stage session to compose ONLY the generation toolset, so the tools cannot join the ordinary chat catalogue.

## Decision

**`@idealize/gen-tools/tools` is the Consumer role of the generation seam.** One `defineTool` registration per artefact kind (`generate_image`, `generate_video`, `generate_audio`), each bound to its media preset from `@idealize/generate`. A call resolves in four steps: `ctx.generation.compatible(preset.requiredCapabilities)` filters the catalogue; zero candidates raises the BRN-09 unavailable state carrying the seam's own recovery sentence; the stored preset→model choice (the `models` map of the `idealize-activity-pills` settings section) selects among the candidates; a stored choice absent from that list is passed over for the first compatible entry. The fallback never rewrites the stored value — a later task retries it — and reports itself twice: the session logs `generation/rerouted` (ignorable) and the tool result carries the same sentence as model-visible text. Outputs commit through `ctx.artefacts`, so the bytes, the durable record, and `artefact/created` are the store's business; a generation failure appends `artefact/failed` with the adapter's `GenerationError` message (MOD-05) and fails the call. Render intent is `generic` cards: the artefact itself already renders through the artefact chat node, so a second presentation would duplicate it.

**`run_in_background` is a config-gated `ctx.jobs` job of kind `generation`.** Long generations return `{kind: 'background', jobId}` immediately and commit their artefacts inside the job; `job_output` and `job_kill` are the model's handles, which is why the seeded compositions carry `@deepseek-ai/dsh-tool-jobs`. Undeclared argument keys reach `execute`, so the disabled case is enforced in the operation rather than by schema omission.

**The package root seeds the two media agents.** Gallery and Sound Stage are written into the user preset root exactly as `@idealize/activity-pills` seeds its five, and never overwrite a root that already holds either id. They do NOT derive from the shipped `standard` preset the way the activity agents do: their compositions are the persona, the generation toolset, and the job controls, with no shell, filesystem, web, or delegation rows. That is AC-06, and it holds because the web-app bundle disables every host-plane tool row — a session's catalogue is its preset's composition.

**The assembled proof is a keyless snapshot beside the package.** `generation.cordis.snapshot.yml` boots the real Loader through the headless driver with the replay adapter scripting one `generate_image` call and the fixture backend serving the bytes; the run pins the tool result, the persisted event sequence, and the committed `artefact/created` payload. The Client half reads that same committed payload and folds it through the artefact Definition, so the chat node is proved over an event a real turn produced rather than a hand-written one. `packages/idealize/*/tests/**/*.snapshot.ts` joined the snapshot config's include list (logged in FORK.md): the fork ships no runnable example of its own, and an IDEalize scenario mounts `@idealize/*` rows no upstream example declares.

`@idealize/artefacts` joined the `tsconfig.base.json` paths facade — gen-tools is its first cross-package consumer, and without the mapping vitest and the tsx source launch fall back to built `lib/`.

## Alternatives considered

**Registering the tools from the package root (host plane).** Rejected: a host-plane registration puts the generation tools in every session's catalogue, which is exactly what AC-06 forbids. The root plugin seeds presets only.

**Deriving the media compositions from `standard`, as the activity pills do.** Rejected for the same reason: `standard` carries the full coding tool set.

**Rewriting the stored model when it disappears from the catalogue.** Rejected: an adapter that is briefly unavailable would silently lose the user's choice. The stored value is the user's decision, and only the Brains pane writes it.

**Folding the chat node inside the package's host-face composition test.** Rejected: the artefact Definition lives in the Client aggregate, and importing it from a host test mixes the two compiler faces (`tsc -b tsconfig.host.json` cannot resolve the client-side module augmentation). The fold moved to a `*.client.spec.ts` over the committed event.

## Consequences

A Gallery or Sound Stage session composes three tools and nothing else, so the Gallery UI slice (S5) can assume every artefact in a project came from one of them. `generate_video` works end to end against `@idealize/gen-fixture` and reports the unavailable state against the live OpenRouter catalogue, which serves no video model — that path stays a genuine product state until a video route or another adapter lands. Background generations are covered at the gating level only (missing job service, disabled config); an owned job running to completion through a live agent awaits the Gallery slice's assembled coverage. Routing is first-compatible: no cost or quality ranking exists, and the compatible catalogue's order is registration order.
