# Agent Note: One roster route serves both welcome steps, and its fields enforce that a tile can never refuse

Status: implemented

Part of the spaces-and-brains reshape; the space table and the `spaces` map the route reads are defined in [the spaces vocabulary](2026-08-26-idealize-spaces-vocabulary.md), and [the two-step welcome card](../feature/2026-08-26-welcome-card-space-then-brain.md) and [the composer's brain switcher](../feature/2026-08-26-in-session-brain-switch.md) are its readers.

## Problem

The reshaped welcome card is two steps: pick a space, then pick a brain. JJ's binding rule for it is "dead end only once" — the chooser offers, and the brain screen explains. No space tile is ever dimmed, disabled or dropped; every reason, recovery and refusal appears on the second screen, where the user can act on it.

A rule stated only in prose gets undone by the next well-meaning change. Somebody reads that Motion has no generation backend, and helpfully greys the Motion tile.

The availability facts also sit in three places. Media spaces read the generation seam through `GET /idealize/brains/media` (`packages/idealize/generate/src/routes.ts:59-66`), which already returns `availability: { state, reason, recovery }` per media preset. Chat and Terminal have no media preset at all: their model check is the deployment default model, the free route, and the per-brain overrides that `GET /idealize/activity/models` resolves (`packages/idealize/activity-pills/src/index.ts:181-194`). Two screens fetching two or three routes each can disagree with themselves mid-render.

## Decision

**`GET /idealize/spaces` on `@idealize/spaces` serves one entry per declared space: `{ id, brainCount, models: 'some' | 'none', reason?, recovery? }`.** One fetch feeds both steps.

**The field split is the enforcement.** A tile reads `id` and `brainCount`; there is no other field it could read, because none exists. `models`, `reason` and `recovery` are the brain step's, and the route's own JSDoc says so at the module, at the type, and on each field, so a later reader who wants to surface a reason on a tile has to argue with the code rather than guess at the intent.

**`brainCount` comes from the roster plus S1's `spaces` map.** `agentPresets.list()` supplies the brains; `presetSpaces` places each one, from the stored `spaces` map of the `idealize-activity-pills` section when the user has set it and from the computed default otherwise. A refused space still reports its count, which is the whole point: Gallery with a brain and no backend reads "1 brain" on the tile and states the missing backend on the next screen.

**`models` reuses the existing availability reads rather than adding capability plumbing.** The generation service is optional to this package and probed with `ctx.get`; its verdict's `reason` and `recovery` pass through unchanged, so the brain step says what the Brains pane already says. A composed service with no backend and no composed service at all both read `no-backend`, because they are the same answer to the question the brain step asks.

**Chat and Terminal read the settings sections directly, restated rather than imported.** The three facts are the `agent-default-model` section, the free route in `llm-pi-ai`, and the `models` map of the activity section. `@idealize/activity-pills` already exports the pure resolver, but importing it would point `@idealize/spaces` at the package that must later read this package's space table, and TypeScript project references forbid the cycle. Restating a settings-document face is the pattern `@idealize/generate` already uses for the same section (`packages/idealize/generate/src/media.ts:78-80`).

**Terminal declares `requiresDesktopShell` in the space table, and the roster turns that into a brain-step refusal.** With a declared roster the Terminal tile shows in a plain browser, where it used to hide itself. The tile keeps its brain count; the brain step reads `desktop-only` and states that the terminal runs in the desktop app. That is the invariant working as intended rather than a regression to patch.

## Alternatives considered

- **Let the tiles read `models` and dim the unavailable ones.** It is the obvious UI and it is the exact dead end JJ ruled out: the user learns nothing from a grey tile, and there is nowhere on a tile to put the recovery.
- **Scatter the reads: the chooser fetches the roster, the brain step fetches availability.** Fewer fields per response, and two screens that can disagree about the same space within one interaction. Aggregating also means the brain step needs no fetch of its own when the user advances.
- **Fetch `/idealize/brains/media` and `/idealize/activity/models` over loopback from inside the roster handler.** It composes the named routes literally, and it makes one host route depend on its own web server's port, its own auth header, and two round trips per read. Reading the same services and settings sections directly gives the same answers synchronously.
- **Import `resolveActivityModels` from `@idealize/activity-pills`.** It reuses the owning package's own resolution, and it creates the dependency cycle that `presetSpaces` will close from the other side in S3 and S4.
- **Keep the capability requirement in the space table instead of looking it up in `MEDIA_PRESETS`.** Two homes for one fact, and the two drift the first time a preset's requirement changes. `spaceCapabilityRequirements` resolves the table against the declared presets at load and throws when a space names a preset nothing declares, so a mismatch is a boot failure rather than three spaces quietly reporting a missing backend.
- **Report `models: 'some'` for Terminal in a browser, with the shell fact in a separate field.** Technically more precise — models do exist — and it leaves the brain step with two fields to reconcile before it can state one refusal. `models` answers "can a model serve this space from here", and in a browser the terminal cannot be opened at all.

## Consequences

The welcome card can be built with no availability logic of its own: step 1 maps entries to tiles, step 2 branches on `brainCount` and `models`. S3 owns the copy; the recovery strings here are the fallbacks a surface can render verbatim.

`@idealize/spaces` now depends on `@idealize/generate` for `MEDIA_PRESETS` and the availability type. The dependency runs one way and the client face stays types-only, so nothing new reaches a browser bundle.

The route mounts under `webServer`, `agentPresets` and `settings`. A composition without the preset roster serves no roster — which is right, because a deployment with no brains has no chooser to draw.

Proof, captured from a real Loader composition and committed beside the package: [`proof/roster-with-backend.json`](../../../../packages/idealize/spaces/proof/roster-with-backend.json) and [`proof/roster-no-backend.json`](../../../../packages/idealize/spaces/proof/roster-no-backend.json). Motion reads `models: 'none'` in both; Gallery reads `'some'` with the fixture backend mounted and `'no-backend'` without it; every space carries a `brainCount` in both runs.
