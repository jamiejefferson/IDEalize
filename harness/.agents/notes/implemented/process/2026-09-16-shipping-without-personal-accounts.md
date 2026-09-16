# Agent Note: Shipping without personal accounts, client names or a Chinese UI

Status: implemented

## Problem

JJ set three conditions for the public build on 16 Sep 2026: "all client work refs need to be removed", "no keys or platform accesses should be shipped with the product - these are my personal accounts used for testing and my own work", and "there should be no deepseek refs or chinese language in the product or documentation. its ok for there to be a DeepSeek credit, but thats it." The feedback plugin embedded JJ's Supabase project URL and publishable key; a client name and a client vault path sat in shipped test fixtures, a skill example and the desktop keys-file script; the upstream locale plugin defaults to Chinese for a non-English browser and offers a Language row; the desktop repository's front-page README, contributing guide, code of conduct and docs folder were the upstream Chinese originals with English siblings.

## Decision

The feedback plugin takes `endpoint` and `publishableKey` from its config, else from `IDEALIZE_FEEDBACK_ENDPOINT` and `IDEALIZE_FEEDBACK_KEY`; nothing ships in code or the profile. Without both, a submission still lands in the local backup and the route answers 503 with `backedUpLocally: true`, so the panel shows its "kept locally" state, and the announcements route answers an empty list. Client names in shipped files became neutral placeholders (`Acme`, `/Users/jj/Notes`, "ship the proposal, pause the audit"). `@idealize/ui-bar` pins the active locale to English whenever it moves and shadows the General settings' `language` row with nothing, leaving the upstream locale plugin untouched. In the desktop repository the English siblings replaced the Chinese originals for the root README, CONTRIBUTING, CODE_OF_CONDUCT and `docs/`, the plugin README lost its Chinese sibling and hash record, and `verify-layout` no longer checks a README hash record. The tray's "DSH home" entry reads "harness home".

## Alternatives considered

Keeping the publishable key on the grounds that row-level security limits it: rejected, the account is JJ's and the directive is about ownership, not exposure. Changing `FALLBACK_LOCALE` and the locale list upstream: rejected for now, every upstream plugin registers a Chinese dictionary against that list and hundreds of upstream tests assert the Chinese labels, so the product-side pin is the smaller change. Deleting the Chinese dictionaries from `@idealize/*` plugins: not possible while the upstream registry requires every shipped locale per namespace.

## Consequences

A build with no feedback environment keeps feedback locally and shows no announcements; the composition that ships to JJ's own machine can set the two variables in its environment. The Language row disappears from General settings and a durable `zh` preference is rewritten to `en` at the next boot. The Chinese dictionaries remain in the code as dormant data, and the wider corpus (`README.zh.md` siblings, `.zh.md` docs, the `@deepseek-ai/dsh-*` package scope, the DeepSeek provider and models) stays for JJ's decision, recorded on the project board.

## Evidence

`packages/idealize/feedback/tests/routes.spec.ts` (configured, environment and unconfigured cases), `packages/idealize/ui-bar/tests/apply.client.spec.ts` ("pins the locale to English and empties the Language row"), desktop `tests/keys-file.spec.ts` and `tests/idealize-this.spec.ts`, `node scripts/verify-layout.mjs`.
