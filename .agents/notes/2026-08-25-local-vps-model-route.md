# Local VPS model route — what is wired, and the window that blocks agent use

A self-hosted model runs on JJ's VPS and is already declared as a provider route
in `~/.dsh/settings.yaml`. It serves prose well and cannot currently drive the
IDEalize agent. This note records the wiring, the measurements behind that
claim, and what would have to change.

## What is already in place

`~/.dsh/settings.yaml` carries a hand-declared `mutter` route under
`llm-pi-ai.providers`. Nothing else was changed: `agent-default-model` still
points at `kimi-coding`/`k3`, and `agent-presets.default` is still `coding`.

```yaml
llm-pi-ai:
  providers:
    mutter:
      displayName: Mutter VPS
      apiKeyEnv: MUTTER_API_KEY
      api: openai-completions
      baseURL: https://srv1642866.hstgr.cloud/v1
      compat:
        supportsReasoningEffort: true
      models:
        - id: qwen3.8-uncensored
          name: Qwen3.8 9B uncensored
          contextWindow: 16384
          maxTokens: 2048
          reasoningEfforts:
            "off": none
            high: high
```

`MUTTER_API_KEY` resolves through the credentials seam from
`~/.dsh/.credentials.yaml`. The endpoint sits behind Caddy, which matches the
bearer token exactly and answers 401 otherwise.

Two details that cost time and are not obvious from the schema:

- `reasoningEfforts` must declare a level beyond `off`, or the plugin refuses to
  load. Setting `reasoningEfforts: false` is the alternative for a model treated
  as non-reasoning.
- Ollama ignores the `think` flag on `/v1/chat/completions` (ollama#14820).
  `reasoning_effort: "none"` is what actually suppresses reasoning there, which
  is why `compat.supportsReasoningEffort` is set.

## The blocker, measured

The harness sends far more than the model can accept. Read off the server, not
estimated:

```
request (23870 tokens) exceeds the available context size (16384 tokens)
```

| What ran | Prompt tokens | Fits in 16,384 |
| --- | --- | --- |
| Bare HTTP call, no system prompt | 28 | yes |
| `dsh --profile headless` | 23,870 | no |

A retry pass trimmed it to 17,744, which still overflowed.

**Presets are not the lever.** A stripped preset carrying one persona plugin and
no tools produced byte-identical 23,870 tokens. The tool schemas and system
prompt enter at profile level, above the preset, so preset composition cannot
reduce them. That experiment has been run; do not repeat it.

**Raising the window does not rescue it either.** The context ceiling is RAM on
a 2 vCPU / 7.8 GB box with no GPU, not the model — the GGUF itself declares
262,144. Measured footprints: 16k uses 6.7 GB and leaves 789 MB free; 24k uses
7.0 GB and starts swapping; 32k leaves 157 MB and is unsafe. Even at 24k the
harness would arrive with 23,870 tokens and leave nothing for the work.

## Performance, for anything built on this route

Generation runs at roughly 5 tokens/sec. Prefill runs at 11.7 tokens/sec, so
prompt size dominates wall-clock far more than output length does. A 9,019-token
prompt spent 773 seconds before its first output token. llama.cpp caches the
prompt prefix, so a repeated call with an unchanged prefix is fast while the
first is not. The model unloads after 30 minutes idle and costs about 17 seconds
to reload.

The practical consequence: anything built against this route should send as
little fixed preamble as possible. A writing surface that ships no tool schemas
and no system prompt gets a reply in about 30 seconds cold. Every kilobyte of
standing prompt is paid for on every uncached call.

## Reference documentation

All local, all current to the installed runtime:

- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-llm-pi-ai/README.md` — provider
  routes, hand-declared endpoints, `compat`, per-model capacities. The
  authoritative doc for this wiring.
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-llm/README.md` — the LLM seam.
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-presets/README.md` —
  preset composition and the scope chain.
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-default-model/README.md`

## What would unblock agent use

One of these, not a combination of tweaks:

1. A writing surface in IDEalize that bypasses the agent stack and calls the
   route directly with the user's text and no standing prompt. This fits today
   and is the only option that needs no new hardware.
2. A host with enough RAM for a 64k window, which is roughly 24 GB for this
   model. On CPU alone it would still be slow; a GPU with 24 GB VRAM is the
   version that feels responsive.

A working reference for option 1 exists at `~/.local/bin/qw`: it sends 28 prompt
tokens, streams the reply, and keeps a short history file. It is the shape a
writing surface should copy.
