# Agent Note: A connected key gateway takes every routed chat first

Status: implemented

## Problem

JJ connected IDEalize to Equator's key gateway (KeyBus) on 10 Nov 2026. The gateway's routes (`gateway-anthropic`, `gateway-openrouter`) joined the router's candidate list beside JJ's own Codex and Claude subscriptions, and no chat used them. A signed-in subscription prices as `free` and a gateway route as its listed token price, so the cost weight always favoured the subscription, and `preferFree` (on by default) stopped any move onto a priced route as `needs-payment`. A test chat started on a gateway model was moved to Codex on its first turn. JJ asked that IDEalize prefer the gateway whenever one is connected and keep direct keys as the fallback.

## Decision

`decide` reads a connected gateway from the candidate list (any candidate whose provider starts `gateway-`). While one is connected:

- A chat whose model is a direct route moves onto the gateway on its next routed turn, whatever the gates say: the same model through the gateway when the gateway lists it (`anthropic/claude-sonnet-5` becomes `gateway-anthropic/claude-sonnet-5`), else the gateway model that scores best. The person's one-star bars and the context-window check still hold; when no gateway model fits, ordinary routing runs. The decision carries `gateway: true`, and `routeTurn` lets it through when Jev gave no reading, as it does the `sight` move.
- The router moves a chat only between gateway models.
- `preferFree` never holds back a gateway model: the organisation behind the gateway pays for it, so the person starts no spending.

Direct routes stay in the candidate list, so the existing fallback is unchanged: a routed gateway turn that fails returns to the chat's own model, the router notes the refusal, and stand-ins can reach the direct keys.

A gateway route reads the token prices of the company it fronts (`candidatesFrom`'s price lookup and the shipped-price table in `index.ts`), so the cost weight still steers between cheap and expensive gateway models.

## Alternatives considered

**Pricing gateway routes as `free`.** The person does not pay, but the cost weight would then see every gateway model as equal on price and pick the most capable one for every turn, spending the organisation's budget on quick questions.

**Removing direct routes from the candidate list while a gateway is connected.** Stand-ins read the same list, so a failing gateway would have nothing to hand a turn to.

**Asking the person to delete their direct keys.** It works without code, but loses the fallback JJ asked to keep.

## Consequences

With a gateway connected, chats that are not routed (routing off, a locked chat, an image, sound or video chat) keep their own model, which may be a direct route. A gateway that refuses a model (the organisation's preset does not allow it) costs one failed request, after which the turn returns to the chat's own model and the router leaves that gateway model alone for a week. Evidence: `router/tests/decide.spec.ts` ("a connected key gateway") and `router/tests/route.spec.ts` (the Jev-silent move and gateway pricing).
