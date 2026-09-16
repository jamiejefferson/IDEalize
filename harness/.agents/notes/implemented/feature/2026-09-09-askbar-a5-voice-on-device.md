# Agent Note: holding a chip speaks, and the speech never leaves the machine

Status: implemented

JJ, 9 Sep 2026, after landing 19: "then do the ask bar". The Askbar's A1–A4 slices had shipped; A5, the voice half of the hold gesture, was the next unbuilt slice in `.idealize/plans/askbar-plan.md`. The gesture already existed with its `listening` and `pending` states and no audio behind them.

## Problem

The plan blocked A5 on one decision: the speech provider and where audio is processed. The product spec makes a chain of obligations conditional on that answer — a disclosure before the first capture leaves the device, a stated provider retention policy, and a cancellation that tries to abort processing already uploaded (spec §"Voice"). All three exist only if the audio crosses the network.

## Decision

JJ chose on-device, 9 Sep 2026, over hosted transcription on the OpenAI or fal routes already connected. The audio reaches no network, so the disclosure becomes a notice rather than a consent gate, there is no provider retention policy to state, and cancellation is a local matter.

`@idealize/transcribe` is the seam: a `ctx.transcription` Service Definition (a provider registry, an explicit `resolve(request)` step holding a capture to the provider's sample rate and the configured bounds, and dispatch), the `local-whisper` provider running `onnx-community/whisper-base.en` through `@huggingface/transformers`, and three loopback routes. Measured on this machine: 472 ms to load a cached model, about 500 ms for a seven-second capture, 77 MB fetched once into `<home>/speech-models`.

**Decoding belongs to the browser.** The recorder is Chromium, which already holds codecs; `capture.ts` records, decodes and resamples to 16 kHz mono in the window, and what crosses to the host is float samples. Nothing in the host package parses an audio format, and no audio file exists at any point — the samples live in page memory for one capture.

**The destination is locked at the press.** The chip the pointer went down on owns the capture, the transcript and the send, so a roster that moves underneath cannot redirect it.

**A transcript nobody can vouch for is a draft, not a message.** `confident` is decided from the text — empty, or only a non-speech marker such as `[BLANK_AUDIO]` — because this pipeline publishes no per-token likelihood, and the provider never invents a score. An unconfident transcript opens the panel holding the words, and so does a send comm refused, so a capture is never lost to a failed delivery.

**A first run records anyway.** A capture that meets a model still being fetched is held in memory, the bar shows the percentage, and the same samples are transcribed when the model arrives.

## Alternatives considered

**A hosted transcription API.** Faster and more accurate, and both routes are already connected. It brings the disclosure, the retention policy and the abort-the-upload path with it, and puts JJ's speech on someone else's machine for a gain neither of us can measure at this length of dictation.

**Bundling the model in the app.** It would remove the first-run wait and add roughly 77 MB to every install, including for the people who never speak to a chip.

**Decoding in the host.** It would need a codec for whatever container the recorder produced, in Node, where the browser next door already has one.

## Consequences

`pnpm-workspace.yaml` names two install scripts pnpm blocks by default, and denies both. `onnxruntime-node`'s postinstall fetches only the CUDA execution provider, too large for the registry; the CPU runtime this seam uses ships inside the package, and whisper loads and transcribes with the script denied. `sharp`'s downloads libvips for the image pipelines `@huggingface/transformers` also carries, which this seam never reaches. The desktop repo runs yarn with `enableScripts: false`, so neither script runs there either.

A plugin that declares `inject: { required: [...] }` runs `apply` on a fiber whose services do not reach the root, so a service composed there is never published. `@idealize/transcribe` declares none and waits for the web server inside instead; the module's JSDoc records why, because the shape looks like an omission.

The speech notice is remembered in window storage (`idealize.askbar.speechNotice`) rather than settings, so it cannot be read again from the interface once dismissed. Cleared storage shows it again, which is the safe direction.
