# Agent Note: sorted model pickers, one coordinator row, and a way off an unreachable route

Status: implemented

JJ, 7 Sep 2026, three items of feedback on the Brains pane and the welcome card: "model sorting in dropdowns, needs to be in alphabetical order"; "project coordinator repetition"; "struggling to get the model working on gallery, sound and video. so these cannot be used."

## Problem

**Pickers listed models in route order.** `GET /idealize/models/state` serves providers in registration order and each provider's models in catalogue order, and every picker rendered that order as it came. The onboarding Tools step did the same.

**The coordinator role appeared twice.** Under Agent roles the Project Coordinator brain had a row with a model picker and Edit. Under it, a "Project leadership" section offered one more picker, "Project Coordinator", choosing which preset plays the role over `/idealize/comm/roles`. With the preset named Project Coordinator already on the list, the second picker read as the same choice asked again. JJ had flagged it on 1 Sep ("Agent roles and Roles are not both needed. Or if they are, the wording isn't clear.") and again on 7 Sep with a screenshot.

**Gallery, Sound Stage and Video could not be used, and the pane said the wrong thing about why.** JJ's install has its default model on the `openai-codex` route with no ChatGPT sign-in (the OAuth store holds OpenRouter alone). Every brain that follows the default is therefore unreachable, and the three generating brains follow it by design: the 29 Aug generation cluster made a brain confined to one generating space pick only its generation model, and cleared any chat-model override it held, so the chat model that drives its generation tool was invisible and unchangeable per brain. Three defects compounded there:

1. `assessOne` (`@idealize/activity-pills`) knew two unreachable reasons, `no-access` and `terminal-only`. A subscription route with no sign-in fell to `no-access`, so the row read "No key for openai-codex" with an Add key action that opened the key editor, where the ChatGPT route has no key field. The launcher's brain row said the same and did the same.
2. A generating brain had no field for the chat model, so the only way off the unreachable default was changing the default for every brain.
3. The welcome card loaded its roster once per mount. Its own "Add a brain for Video" flow ends in the Brains pane; after the save the card still read "No brains yet" until the next chat re-mounted it.

## Decision

**Every model picker sorts by name.** Providers by display name, models by id, media candidates by model name, all case-blind with digit runs compared by value (`gpt-5.10` after `gpt-5.9`). The Brains pane's inline pickers, its edit sheet and the onboarding Tools step share the rule. The generation picker's empty option still names the route's first candidate, which is the model a generate call falls to, whatever position the sort gives it.

**The Project leadership section is gone.** The Project Coordinator row under Agent roles is the role. Which preset plays it stays in `@idealize/comm`'s settings and its `GET/POST /idealize/comm/roles` route, which no pane surfaces now; the seeded `project-agent` preset plays it, and editing that brain is how the coordinator's model and instructions change. A picker for re-pointing the role at another preset had no user asking for it.

**A third unreachable reason, `no-sign-in`.** `assessPills` takes one more fact, `subscription(provider)`: whether the sign-in surface (`idealizeOAuth.status()`) offers the route. An unreachable route that is offered there, and is not terminal-only, reads `no-sign-in`. The agents route also carries the route's display name (`providerName`) from the same status rows. The Brains pane's row reads "Not signed in to OpenAI (ChatGPT)" with a Sign in link to `/idealize/signin`; the welcome card's brain row reads "Not signed in to OpenAI (ChatGPT). Sign in to start here." and opens the sign-in surface on click. `no-access` keeps its key wording and its key editor, now naming the route by its display name where the directory knows it.

**A generating brain has two models.** The edit sheet for a brain confined to one generating space asks "Generation model" (the space's compatible candidates, saved through `/idealize/brains/media`) and "Chat model" (the chat catalogue, saved as the brain's own override through `/idealize/activity/agent`). The inline row keeps the generation picker alone, and choosing there no longer clears the chat override. This reverses the 29 Aug note's clearing rule: a confined brain talks through a chat model, and a person with an unreachable default needs to move that one brain, not the default.

**The Brains pane raises `idealize:brains-changed` on `document` after every save** — a brain, a model, a CLI, a service key, the provider editor closed — and the welcome card reloads its roster and access map on it. A document event rather than store state because the two surfaces share a document and nothing else.

## Alternatives considered

**Keep the Project leadership picker and reword it.** Rejected: nobody has asked to point the coordinator role at a preset other than the seeded one, and a second control for the same role is what JJ flagged twice. The route stays for the day someone does.

**Make the auto model policy choose a signed-in OpenRouter model when ChatGPT is unsigned.** That would fix JJ's install at its root, but OpenRouter serves hundreds of models and the policy has no rule for picking one; inventing a pick would put an unexplained model under every brain. Deferred, and named under Consequences.

**Keep a generating brain on the default chat model and only reword the note.** The note would then say what is wrong with nothing a person can do about it short of changing the default for every brain. A per-brain chat model is the smaller change for the person, at the cost of reversing the 29 Aug clearing rule.

**Have the welcome card re-read its roster on window focus or on a timer.** The drawer and the card share one window, so focus never changes; a timer would add polling to a surface that is otherwise event-driven. The pane knows when it saved, so it says so.

## Consequences

JJ's install still has its default model on an unsigned route. The pane now says so and offers the sign-in, and each generating brain can be pointed at an OpenRouter model from its Edit sheet without touching the default. The auto model policy (`@idealize/models`) leaves an unreachable default standing when neither ChatGPT nor the free engine is usable, because it knows no other route to choose; OpenRouter's signed-in OAuth is not a route it considers. That is the next defect behind this one and is not addressed here.

`PillReason` gains a member; `AvailabilityFacts` gains a required `subscription` fact, so any caller of `assessPills` supplies it. The `RolesState` read, `assignRole` and the five `brains.roles.*` locale keys are deleted from the Brains pane.

Tests: `activity-pills/tests/seed.client.spec.ts` (the new reason), `ui-bar/tests/brains-panel.client.spec.tsx` (sorted pickers, no leadership table, the sign-in note, the two-model sheet and the change event), `ui-bar/tests/hero-launcher.client.spec.tsx` (the sign-in row, the roster reload on the event).
