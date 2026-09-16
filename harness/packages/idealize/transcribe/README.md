# @idealize/transcribe

The transcription capability seam and the on-device speech provider behind the Askbar's hold-to-speak gesture.

## What it holds

- **Service Definition** — `ctx.transcription`, a registry of speech providers with an explicit `resolve(request)` step and dispatch to the resolved provider.
- **Service Provider** — `local-whisper`, a whisper model run on this machine through `@huggingface/transformers`. Captured samples reach the model in process and no network.
- **Routes** — `GET /idealize/transcribe/state`, `POST /idealize/transcribe/prepare`, `POST /idealize/transcribe`.

The Consumer is `@idealize/askbar`'s client: the chip's press-and-hold records, resamples and posts a capture, then dispatches the transcript through the same `POST /idealize/comm` send the panel's Type action uses.

## Why on-device

JJ chose on-device over a hosted transcription API on 9 September 2026. Audio that never leaves the machine needs no upload disclosure, no provider retention policy and no attempt to abort processing that has already been uploaded — three things the product specification makes mandatory the moment a capture crosses the network.

The cost is the model. On first use the provider fetches roughly 77 MB into `<home>/speech-models` and reuses it from there. Loading a cached model takes about half a second and a seven-second capture transcribes in about the same again.

## The wire

Samples arrive decoded and resampled: the recorder is a browser, so container and codec work happens there and nothing in this package parses an audio format. `POST /idealize/transcribe?rate=16000` takes a body of little-endian 32-bit float mono samples and answers `{ text, confident, ms }`.

`confident` says whether the transcript may dispatch without a person reading it first. A provider that publishes no per-token likelihood decides it from what it can observe — an empty transcript, or one that is only a non-speech marker such as `[BLANK_AUDIO]`, is not confident — and never invents a score.

Every refusal carries a `refusal` tag: `no-provider`, `ambiguous-provider`, `not-ready`, `too-short`, `too-long`, `sample-rate`, `failed`. The Askbar switches on it to tell a capture too short to be speech from a model that is still downloading.

## Configuration

| Field | Default | What it decides |
|---|---|---|
| `model` | `onnx-community/whisper-base.en` | The whisper model run on this machine |
| `dtype` | `q8` | Weight quantisation the model is loaded at |
| `cacheDir` | `speech-models` | Model cache directory, under the harness home |
| `minCaptureMs` | `400` | Shortest capture treated as speech rather than a slip |
| `maxCaptureMs` | `120000` | Longest capture accepted |

## Model Experience

None, as the seam turns captured speech into text for the composer and registers no tool, prompt or session event. What the person sends afterwards is an ordinary message, indistinguishable from typing it.

#### KV Cache effect

Independent of every model request; the transcript reaches a model only as the message the person sends, and nothing here changes request content or ordering.

## Known Limitations and Deferred Work

- **No confidence score.** `confident` is decided from the text alone, because the pipeline this provider runs publishes no per-token likelihood. A clearly-spoken wrong word reads as confident.
- **A run in flight cannot be stopped.** The library takes no abort signal, so a cancelled capture finishes in the background and its text is dropped rather than the work being halted.
- **One provider at a time.** With more than one registered and none pinned, the seam refuses rather than choosing; nothing pins a provider yet because only the on-device one exists.
- **The first capture waits for the model.** Roughly 77 MB is fetched on first use. The Askbar shows the percentage and retries the capture it is already holding, but there is no way to fetch it ahead of time from the interface.
- **The dependency costs the desktop app 267 MB.** `onnxruntime-node` and `@huggingface/transformers`, with the `sharp` image stack the library imports at the top of `utils/image.js`, take the packaged macOS bundle from 533 MB to 800 MB. 52 MB of that is the Linux ONNX runtime shipped inside the Mac app: electron-builder's platform-specific `files` array replaces the root allowlist rather than merging with it, so moving the exclusion there admits the whole source tree into the ASAR and the packaging afterPack check fails. Trimming it needs a different mechanism.
- **macOS x64 has no runtime.** `onnxruntime-node` 1.24.3 ships `bin/napi-v6/darwin/arm64` and no Intel counterpart, so the Intel slice of a universal build loads no provider and the seam reports `unavailable`.
