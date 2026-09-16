# @idealize/gen-tools

The generation toolset and the media agent presets that compose it. `@idealize/gen-tools/tools` registers `generate_image`, `generate_video`, and `generate_audio` — the Consumer role of the `ctx.generation` seam — and the package root seeds the Gallery, Sound Stage and Video agent presets whose compositions carry only that toolset (AC-06). The same composition is the rule for every brain confined to generating spaces: `mediaCompositionFor` builds it, and `@idealize/activity-pills` applies it.

## The tools (`@idealize/gen-tools/tools`, composed from a media agent preset)

Each call routes one task by capability, never by hard-coded model id:

1. The tool's media preset (`images` / `motion` / `sound` from `@idealize/generate`) supplies `taskIntent` and `requiredCapabilities`; `ctx.generation.compatible()` filters the catalogue.
2. Zero compatible models is the BRN-09 unavailable state: the call fails with the seam's recovery sentence (for `generate_video` this is the live state of the OpenRouter catalogue, which serves no video models).
3. The stored preset→model choice (the `models` map of the `idealize-activity-pills` settings section) picks among the candidates. A stored choice absent from the candidates is passed over for the first compatible entry: the stored value stays untouched, the session logs `generation/rerouted` (ignorable), and the tool result carries the same notice.
4. The result's outputs are committed through `ctx.artefacts` — bytes under the project's media folder for the kind (`<project>/Images/` by default; the `idealize-artefacts` settings section names the folders), durable record, `artefact/created` — and the canonical value reports each artefact's id, media type, absolute and project-relative path, byte count, and sha256. A generation failure appends `artefact/failed` carrying the adapter's `GenerationError` message (MOD-05) and fails the call.

Beyond `prompt`, each tool takes the settings its media kind uses: `generate_image` takes `aspect`, `count` and `reference_image`, `generate_video` takes `duration_s` and `reference_image`, and `generate_audio` takes `duration_s` and `lyrics`. `reference_image` is a picture the generation starts from (JJ, 8 Sep 2026: "I tried to use an image created by another agent as a reference when creating a video"): an artefact id, which `ctx.artefacts` resolves whatever chat made it, or a path under the project (`Images/2026-09-08_ab12cd34.png`, relative or absolute). `resolveReferenceImage` reads the bytes and attaches them to `GenerationRequest.attachments` as `{mediaType, data}`; the fal queue adapter sends them as `image_url` and moves a `text-to-video` request to its `image-to-video` sibling. The provider never sees the reference as a setting; the artefact record keeps it under `reference_image` so the enlarged view can say where a picture came from. A path that resolves outside the project (as the filesystem has it, so a project under a symlink admits its own files and a symlink pointing out does not), a missing file, an extension other than png, jpeg, webp or gif, or an artefact that is not an image is refused before any generation, with the cause in the tool error. `lyrics` is the words a music model sings, with structure tags such as `[verse]` and `[chorus]` allowed; a call that leaves it out asks for instrumental audio, and the fal queue adapter fills the field fal's music endpoints require with `[instrumental]`. All three take `options`, an open object of the model's own inputs under their wire names (`resolution: "1080p"`, `camera_fixed: true`), which the queue adapter sends through unchanged and coerces to the endpoint's schema; `scalarOptions` refuses a value that is not a string, number or boolean at the model boundary. Every setting given travels under its own name in `GenerationRequest.settings` (a named parameter wins over an `options` entry of the same name) and is recorded on the artefact.

The composer appends the settings strip's choices to the message as a bracketed tag such as `[aspect 16:9, duration 8, resolution 1080p, generate_audio false]` or `[3 images]`, and each tool's description tells the model to strip the tag from the prompt and map it: `aspect X` to `aspect`, `duration N` to `duration_s`, `N images` to `count` (image tool only), and every other `name value` pair to `options.name`, a numeric value as a number and `true`/`false` as a boolean.

`run_in_background: true` (advertised while `enableRunInBackground` is true, the default) runs the generation as `ctx.jobs` work of kind `generation` and returns `{kind: 'background', jobId}`; the artefacts commit inside the job. UI render intent: `generic` cards (the pending card titles the prompt; the artefact itself renders through `@idealize/artefacts`' transcript node).

## Preset seeding (package root, `idealize-gen-tools` row)

On mount, when the roster holds none of `gallery`, `soundstage` and `video`, all three are written into the user preset root (`$DSH_HOME/.agent-presets`, or `root` from config): a persona row, the `@idealize/gen-tools/tools` row, and `@deepseek-ai/dsh-tool-jobs` for collecting background generations — no shell, filesystem, web, or delegation rows. `video` is Motion's agent (the space table's `agentPreset`), added 7 Sep 2026 after a Video brain created from the Brains pane composed no `generate_video` tool and the model reached for a third-party CLI instead. A root already holding any of the ids is left untouched, so deleting one respects the deletion (the `@idealize/activity-pills` rule); an install seeded before Video existed gains it through the repair pass below, once a Video brain is created there.

Each agent carries a `space` and a `duty` sentence naming its tool and where the result lands; its persona is `mediaPersona(name, [duty])`: the name line, the duty, the reporting line, and the shared voice line.

## The rule: a brain confined to generating spaces composes the generation toolset only

The space owns the tools; the brain owns the model and the instructions (JJ, 7 Sep 2026). Two pure functions state the rule for `@idealize/activity-pills`, which owns the create, save and startup paths that apply it:

- `mediaCompositionFor(spaces, name, instructions)` — when `spaces` is non-empty and every one declares the `media` composition in `@idealize/spaces`' table, the generation-only composition text whose persona is `instructions` when non-empty, else `mediaPersona(name, duties)` over the duties of the media agents serving those spaces in table order (a brain named Retro placed in Images reads "You are the IDEalize Retro agent … You create still images … with the generate_image tool …"). `undefined` for a brain that also works in Chat or Terminal, or in no space: those derive from the shipped `standard` preset.
- `isGenerationOnlyComposition(text)` — true when the composition is a row list carrying the `@idealize/gen-tools/tools` row whose plugin names are all within `GENERATION_ONLY_PLUGINS` (`dsh-persona`, `@idealize/gen-tools/tools`, `dsh-tool-jobs`, `dsh-agent-instructions`). Text the loader's YAML dialect cannot parse is not generation-only.

`activity-pills` applies these on create (a brain placed in generating spaces gets `mediaCompositionFor`), on save (a brain moved into generating spaces is rewritten with it, keeping its instructions; a brain moved out derives from `standard` again, keeping its instructions), and at startup, where a repair pass rewrites every preset under the user root whose spaces all generate but whose composition is not generation-only, keeping its persona and logging one line per repaired preset. `mediaAgentsBySpace()` throws when a generating space names no media agent, so the two tables cannot drift.

## Configuration

| Row | Field | Default | Meaning |
|---|---|---|---|
| `idealize-gen-tools` | `root` | `$DSH_HOME/.agent-presets` | Preset root the media agents are seeded into. |
| `@idealize/gen-tools/tools` | `enableRunInBackground` | `true` | Advertise and accept `run_in_background`. |

## Model Experience

### The three tool definitions

#### What the model sees

Three schemas — `generate_image` (`prompt`, `aspect`, `count`, `reference_image`, `options`), `generate_video` (`prompt`, `duration_s`, `reference_image`, `options`) and `generate_audio` (`prompt`, `duration_s`, `lyrics`, `options`) — each gaining `run_in_background` while `enableRunInBackground` is true. Each description carries the settings-tag mapping above, so the model reads the composer's trailing tag as arguments, and the two picture tools describe `reference_image` as "an artefact id from a previous generation (any chat of this project), or a path under the project", so a model handed an id from another chat's result knows to pass it rather than reach for a file tool it does not have. They join the catalogue of generating sessions only, because the registration lives in the media agent preset compositions (and in every brain confined to generating spaces) rather than the host composition.

#### Token effect

Fixed schema cost per visible tool on every request of a media agent session; ordinary chats pay nothing.

#### KV Cache effect

Prefix-stable while the definitions and their visibility are unchanged. Flipping `enableRunInBackground` rewrites all three descriptions and invalidates reuse from that point.

### Tool results

#### What the model sees

A foreground call returns one line per stored artefact: `<mediaType> artefact <id> (<bytes> bytes, <backend>/<model>) at <absolute path>`. A routing fallback prepends `the stored <preset> model <backend>/<model> is unavailable; this task ran on <backend>/<model>`. A background call returns `started background generation job <id>`, whose outcome the model collects with `job_output`. Failures surface as the adapter's `GenerationError` message, or `no compatible <artefact> generation model is available.` plus the seam's recovery sentence.

#### Token effect

Small and fixed-shape per artefact; the generated bytes never enter the request. A multi-output generation adds one line per output.

#### KV Cache effect

Append-only: results follow the reusable request prefix and do not invalidate existing entries.

## Known Limitations and Deferred Work

- **The background path is exercised at the gating level only** (missing job service, disabled config); a full background generation through a live agent-owned job awaits the Gallery UI slice's assembled coverage.
- **Only the first-compatible fallback is implemented** — no cost- or quality-ranked routing; the compatible catalogue's order is registration order.
- **The tools are absent from `docs/tool-catalog.md`**: the generator globs `packages/*/tool-*`, and this package's tools live behind a subpath export of an `@idealize` package, so the schemas above have no anchored catalog section to link.
- **A reference image reaches the provider as one attachment, whole.** The bytes travel base64 in the request body; a large source picture (tens of megabytes) costs that much on the wire and the tool does not downscale it. An image model on the OpenRouter adapter receives it as a content part, which the model may treat as context rather than as a source picture.
- **Multi-output generations store every output**, and `count` asks fal for that many (`num_images`); a provider with another name for it ignores the setting and returns one.
