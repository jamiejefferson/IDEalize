# @idealize/gen-fixture

A configurable in-memory generation backend for keyless tests. Mounting it beside `@idealize/generate` registers backend id `fixture` (configurable) with the configured models; each model becomes selectable through the seam's compatibility queries and the media preset routes with zero mode-code change — the proof behind AC-13. `generate` returns a fixed tiny payload per artefact (a 1×1 PNG, a silent WAV, a bare-`ftyp` MP4 stub) with ordered progress reports, and rejects an aborted signal with `ABORTED`.

## Configuration (`idealize-gen-fixture` row)

| Field | Default | Meaning |
|---|---|---|
| `backendId` | `fixture` | Registry id the backend registers under. |
| `models` | one image model `fixture-still` | `{id, artefact, inputModalities?}` per published model. |

Test-only: the shipped IDEalize composition does not mount this plugin.

## Model Experience

Indirectly, through the `generate_*` tools of `@idealize/gen-tools`, whose results name this backend and its model ids; the backend itself renders nothing to a model.

#### KV Cache effect

Independent: a fixture generation is a request to no model, and its tool result is append-only output after the chat's reusable prefix.

## Known Limitations and Deferred Work

- **Payloads are fixed stubs** — outputs decode as their media types but carry no content derived from the prompt; tests asserting on generated content need a real adapter.
