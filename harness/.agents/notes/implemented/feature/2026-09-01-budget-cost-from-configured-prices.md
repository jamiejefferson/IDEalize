# Agent Note: Budget tab costs come only from user-configured prices

Status: implemented

JJ's feedback on the Brains pane's Budget tab: it showed token counts alone, no money. The cells now lead with cost, computed from token usage times per-model token prices plus per-provider subscription plan costs.

## Problem

Nothing in the repo knows a price. The usage fold (`@idealize/models` `src/usage.ts`) counted tokens per billing category only; the free-tokens spend page's "value" is served by the external FreeLLMAPI sidecar's analytics; `@idealize/gen-openrouter` hardcodes zero cost on generation records. Turning tokens into money therefore needs price data the repo does not have, and inventing a price table for third-party providers would silently misprice the day any provider changes its rates.

## Decision

**Prices are configuration the user supplies, never shipped or estimated.** `@idealize/models`' config/settings section (`idealize-models`) gains three validated fields: `currency` (ISO 4217, default USD), `tokenPrices` (per provider then model, currency units per million tokens, all four kinds — `input`, `output`, `cacheRead`, `cacheWrite` — required so no kind is ever assumed free), and `subscriptionCosts` (`monthly` per subscription provider, optional `since: YYYY-MM`). No hardcoded price table exists anywhere.

**The fold keeps per-route detail.** `foldUsage` now also accumulates `models: { month, year }` — provider → model → per-kind token counts — because category totals cannot be priced (prices differ per model and per token kind). `emptyUsagePeriods()` is the fold target constructor.

**Pricing is a pure module** (`src/pricing.ts`): metered (API-key) tokens bill at their model's price entry; a metered route without an entry contributes `unpricedTokens` instead of a guess. Every configured subscription plan bills its `monthly` cost whether or not it saw usage (the plan bills regardless); year to date counts from January or from `since`; a signed-in subscription without a plan cost is named in `unpricedSubscriptions`. Free-route work is always zero out of pocket. Subscription-category tokens are never priced by `tokenPrices` — the plan covers them. `configured: false` (no price and no plan anywhere) tells the panel to show a hint instead of zero costs.

**The panel shows what it cannot price.** `GET /idealize/models/usage` adds a `cost` breakdown; the Budget tab's cells lead with the cost over the token count when anything is configured, render token-only cells under a hint otherwise, and print notes naming unpriced tokens and unpriced subscriptions. Nothing renders as a cost of zero merely because its price is unknown.

## Deliberately open (JJ's calls)

- Where prices are entered: settings document / cordis.yml today; an in-panel editor needs design.
- Default currency stays USD (model prices are usually quoted in it); `currency` config changes the display.
- Year-to-date plan cost counts from January unless `since` says otherwise — the honest alternative to guessing a start date.

## Alternatives considered

**Ship a built-in price table for known providers.** Rejected for the reason the Problem section records: nothing in the repo knows a price, and a shipped table silently misprices the day any provider changes its rates. `@idealize/gen-openrouter` hardcoding zero cost is the existing example of how stale built-in pricing behaves.

**Render an unknown price as zero.** Rejected: a zero reads as "free" and hides that configuration is missing. The decision instead reports `unpricedTokens` and `unpricedSubscriptions`, and `configured: false` swaps the cost cells for a hint.

**Price subscription-category tokens through `tokenPrices`.** Rejected: the plan's `monthly` cost already bills whether or not it saw usage, so pricing its tokens again double-counts. Subscription tokens stay covered by the plan alone.

**Guess a year-to-date start for subscription plans.** Rejected: year to date counts from January unless the optional `since: YYYY-MM` says otherwise, the honest alternative to inventing a start date.

## Consequences

- A fresh install shows token counts under a configuration hint; money appears only after the user supplies prices or plan costs, so no figure on the Budget tab is ever invented.
- Pricing is a pure function of the fold and the config, applied at read time: editing a price re-prices every displayed period retroactively, with no stored costs to migrate.
- `foldUsage` now retains provider → model → per-kind token counts alongside category totals, the detail pricing needs and the cost of keeping it.
- A new provider or model contributes to `unpricedTokens` until its `tokenPrices` entry exists; each entry requires all four token kinds, so a partial entry cannot silently zero one kind.
- The user maintains the price table by hand in settings/cordis.yml; an in-panel editor remains open, per the Deliberately open section.
