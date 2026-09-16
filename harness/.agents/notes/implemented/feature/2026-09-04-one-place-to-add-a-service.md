# Agent Note: one place to add a service, asking only for the key

Status: implemented

JJ, 4 Sep 2026: "i don't want the api baked in, i want it easier to add a service like fal. the 'base url' thing is something that I and others will struggle with — something that DAYS AGO i asked if there was a fix for." Then, on the first draft of the plan: "i don't understand any of that about the custom provider integration. all im interested in, is making it intuitive for users."

## Problem

Adding a service asked for facts the person does not have. The custom-provider card (upstream `ui-settings-models`) opened on a **Base URL** field, with the route id, display name, wire protocol and model list behind "More options". Someone holding a fal.ai account and an API key holds neither an endpoint nor a protocol, so the first field was already a wall.

Worse, it was the wrong door. That card only ever makes a **chat** provider. Generation backends had no add path at all — they were cordis plugin rows, and the Brains "Media keys" section listed only backends already installed. So the one surface saying "add" could not add the thing JJ wanted, and the thing that could was not presented as adding anything.

The failure JJ actually hit on 3 Sep followed from that: the card sent `Authorization: Bearer` where fal wants `Authorization: Key`, and reported "answered 401; check the API key" — advice that sends the person back to a clipboard that was never the problem.

Three lists showed overlapping accounts (Subscriptions, Token Use, Media keys), each with its own way in.

## Decision

One Services list, and one route behind it.

`@idealize/services` joins the two registries the app already keeps — chat routes from `ctx.llm.listConfigurableProviders()`, generation backends from `ctx.generation` — into one list where each row says what it makes. `POST /idealize/brains/services {id, kind, apiKey}` stores the key where that kind of service keeps it, so the caller supplies a name and a key and nothing else.

In Brains, the Media keys and Token Use provider lists give way to that one section: connected services first, "Add a service" for the rest, one password field with a link to the service's own key page, and "Something else…" keeping the web-address card as the marked advanced route.

Two rules the implementation enforces rather than merely intends:

- **A chat route's `apiKeyEnv` is recorded in the same call as its key.** A dormant pi-ai route stays dormant until its profile names the credential, so storing the key alone would report success and connect nothing.
- **The derivation matches upstream's `deriveKeyRef` (`<ROUTE>_API_KEY`).** A key pasted on either surface must reach the same credential, or one of them silently leaves the route unauthenticated.

## Alternatives considered

**A service directory as data, with wire protocols as a small adapter table** (the original wave F plan). Still the right end state for making fal "not baked in", and the plan keeps it. It is not what unblocks JJ: the registries already know every service's name, endpoint and protocol, so the intuitive flow needed no new data layer at all. Building the directory first would have delayed the fix behind a refactor the person never sees.

**Leaving the chat card alone and adding a media-only picker.** Smaller, no upstream touch, and it reproduces the exact fault: someone wanting fal still has to know it is a "media service" and not a "provider". JJ chose one door explicitly.

**Listing sign-in routes in Services too.** Rejected: an OAuth route with no key would show one account in two sections and offer it a key it does not take. A route holding a key stays listed whether or not sign-in is also offered, because there the key is what makes it work.

**Verifying the key on connect.** Deferred. There is no per-service idea of a cheap probe, and a wrong-but-well-formed key currently reads as connected until the first request fails. Recorded in the package's Known Limitations.

## Consequences

- The Brains Models tab loses two provider lists and gains one. `brains.mediaKeys.*` and the metered provider rows are deleted rather than shimmed, per the pre-release stance; `GET/POST /idealize/brains/media-keys` stays on the host, still proven by `@idealize/gen-fal`'s own tests, with no client reader.
- A refusal the launching environment caused answers **409** with the store's own reason instead of a generic key failure. `credentials-local` rejects a write that an inherited environment variable would shadow, and the old copy would have told the person to check a key that was never wrong. Found by the composition test, not by review: the machine running the tests holds real keys in its environment.
- `@idealize/services` composes after the generation adapters. Composed earlier, its list carries no backend they had not yet registered — the row order in `bundle-idealize/cordis.patch.yml` is load-bearing.
- No upstream file was touched. The advanced card is reached through the existing re-hosted editor sheet, so the fork-touch the plan anticipated did not arise.
- The wave F plan's F1/F2/F4 (adapter table, declarative directory, retiring `gen-fal` and `gen-openrouter` as packages) remain open. They make the *next* service a data row; this note makes the *current* ones addable.
- Still open, and only JJ can close it: no `FAL_KEY` exists on this machine, so fal has had no real-API smoke. The Video space stays honestly unavailable until a key is pasted through the new list.
