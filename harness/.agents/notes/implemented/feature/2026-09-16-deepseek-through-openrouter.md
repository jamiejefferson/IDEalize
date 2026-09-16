# Agent Note: DeepSeek through OpenRouter, and web search on the same key

Status: implemented

## Problem

The base composition made a fresh install depend on a DeepSeek subscription twice: `agent-default-model` named the official DeepSeek route, and `web.searchProvider` named the DeepSeek search provider, so a person with only an OpenRouter key saw "No key for deepseek-official" on the default model and a failed `web_search` tool. JJ, 16 Sep 2026: "for my users the deepseek models will need to come through openrouter, so i'd like to remove the reliance on a deep seek subscription - although happy for people to add it if they have their own."

## Decision

The IDEalize profile overrides `agent-default-model` to the OpenRouter route with `deepseek/deepseek-v4-flash`, points `web.searchProvider` at a new `openrouter` provider, and disables the `web-search-deepseek` row. `@idealize/web-search-openrouter` registers into `ctx.web`: one chat completions request with OpenRouter's `web` plugin attached, the assistant text as `content`, the `url_citation` annotations as sources, the key resolved per search from the credential store under `OPENROUTER_API_KEY`, the same reference the chat route stores. The official DeepSeek chat route stays in the Services list for anyone with their own key. `@idealize/ui-bar` shadows the settings onboarding list's `deepseek-official` entry, whose dialog asks for an official DeepSeek key.

## Alternatives considered

Keeping DeepSeek search and letting the tool fail without a key: rejected, the tool would be offered and broken for every user on the team keys file. Mounting Exa or Perplexity instead: rejected, each needs a further account, and the OpenRouter key every user has already pays for the web plugin. A `searchProvider` chosen at load from the environment with `!!js`: rejected, keys arrive through the credential store at runtime, after load.

## Consequences

A fresh install works end to end on one OpenRouter key. Each search costs one auxiliary OpenRouter request plus the plugin's per-result charge, outside the session's token count. A model that answers without citing returns text and no sources. No keyless snapshot exercises the provider; the package tests cover mapping, credentials, cancellation and the seam boot, and the tool's model-facing rendering is unchanged.

## Evidence

`packages/idealize/web-search-openrouter/tests/openrouter.spec.ts`, `packages/idealize/bundle-idealize/tests`, `pnpm run verify-cordis-config`, `packages/idealize/ui-bar/tests/apply.client.spec.ts`.
