# Agent Note: IDEalize packages join the invariant-companion and Cordis-catalog gates

Status: implemented

English | [中文](2026-08-20-idealize-packages-join-invariant-and-catalog-gates.zh.md)

## Problem

The fork added eleven `packages/idealize/*` workspaces without `./invariant` companions, and four of them declare Context services and one event that the Typert-backed Cordis catalog did not know how to place. Two repository gates therefore failed on every run: `scripts/test-invariants.spec.ts` expected one companion per package manifest and found 219 of 230, and `packages/typert/generator/tests/cordis-catalog.spec.ts` stopped at the first unannotated public property (`IdealizeBridge.buffer`) before it could report the missing JSDoc, page mappings, and type-link owners behind it.

## Decision

Every IDEalize package owns `src/invariant.ts`, exports `./invariant`, publishes `lib/invariant.js`, carries `@deepseek-ai/dsh-invariants` as peer and dev dependency, and references `runtime-diagnostics/invariants` from its tsconfig. `@idealize/cron` checks that an `idealize/cron-run` payload pairs `durationMs` with an executed status and omits it for `skipped-busy`; `@idealize/host-bridge` checks that the same event lands in the bridge buffer as a `cron-run` notification one microtask after the emit. The other nine packages state the package-specific reason no runtime relation exists.

The catalog generator maps `idealizeCron` and the `idealize/*` event scope onto `docs/subsystems/schedule.md`, `idealizeOAuth` onto `credentials.md`, `idealizeAttribution` onto `token-meter.md`, and `idealizeBridge` onto `web-server.md`; `schedule.md` gained the generated-region markers. `CronRun`, `CronTask`, `TaskView`, and `OAuthProviderStatus` are type-link exemptions owned by their source files, and the three client section/opener services (`settingsOpen`, `agentPresetSection`, `modelsSettingsSection`) are walk exemptions owned by their package READMEs. The event and the four services carry the `@mode`, `@param`, and `@returns` JSDoc the generator requires.

## Alternatives considered

- **A dedicated `docs/subsystems/idealize.md` page** — rejected for now: a new bilingual page needs its own prose, pairing record, and website mapping; the existing pages already describe the subsystem each service extends.
- **Marking the IDEalize packages exempt from the companion gate** — rejected: the gate's value is that ownership is exhaustive; an exemption list would drift the moment the next package landed.

## Consequences

- `pnpm vitest run` passes on the fork without skipping or deleting any test.
- Every new `packages/idealize/*` package must ship its companion and catalog rows in the same change, exactly like an upstream package.
- The generated regions in four upstream subsystems pages now list IDEalize services; each regeneration after an IDEalize service change touches those pages and their pairing records.
