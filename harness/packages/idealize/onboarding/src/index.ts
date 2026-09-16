/**
 * @idealize/onboarding — first-run onboarding, host half: the durable
 * `idealize-onboarding` settings section and the wizard's detection/save
 * routes. The browser half renders the five-step wizard (agents, tools,
 * projects folder, documentation folder, finish) gated by this section,
 * exactly as the tour is gated by `idealize-tour.hasSeenTour`: `done` closes
 * the flow for good, `steps` records each step's outcome so a relaunch
 * resumes where the user left off, and `completedAt` timestamps a completed
 * run.
 *
 * Routes (loopback-fenced; the mutation demands the `x-idealize-auth`
 * header; see ./routes.ts):
 * - `GET  /idealize/onboarding/agents` — Claude Code CLI detection (through
 *   the subprocess seam's executable resolution) and OpenRouter credential
 *   presence.
 * - `POST /idealize/onboarding/openrouter` — verify-then-store an OpenRouter
 *   key: the credential plus the `openrouter` provider route's `apiKeyEnv`
 *   binding in the `llm-pi-ai` section (the only write a catalog route needs).
 * The tools step reads and writes through the existing
 * `/idealize/models/state`, `/idealize/activity/*`, and `/idealize/brains/media`
 * routes; the folder steps reuse @idealize/setup's routes.
 *
 * @module @idealize/onboarding
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { ONBOARDING_STEP_IDS } from './step-ids.ts'
import { installOnboardingRoutes } from './routes.ts'

export { ONBOARDING_STEP_IDS } from './step-ids.ts'
export type { OnboardingStepId, OnboardingStepOutcome } from './step-ids.ts'
export { OPENROUTER_KEY_ENV } from './routes.ts'
import type { OnboardingStepId, OnboardingStepOutcome } from './step-ids.ts'

/** Cordis plugin name. */
export const name = 'idealize-onboarding'

/** The settings namespace both halves share. */
export const ONBOARDING_SETTINGS_NAMESPACE = 'idealize-onboarding'

/** Deployment-owned endpoint overrides. */
export interface Config {
  /** OpenRouter API base URL; the default is the public API. */
  openrouterBaseURL?: string
}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  openrouterBaseURL: z.string(),
})

/** The public OpenRouter API base (an external spec constant, not a tunable). */
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1'

/**
 * The durable `idealize-onboarding` section. `steps` is sparse at rest — a
 * step the user never resolved has no key — but its type rides the schema's
 * full-key Record, so readers must treat a missing key as "untouched".
 */
export interface OnboardingSettings {
  /** True once the flow completed or was skipped wholesale. */
  done: boolean
  /** Per-step outcome, keyed by step id (sparse at rest; schema default `{}`). */
  steps: Record<OnboardingStepId, OnboardingStepOutcome>
  /** When the flow completed (ISO); a skip-all leaves it absent. */
  completedAt?: string
}

/** Runtime schema for {@link OnboardingSettings}. */
export const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  done: z.boolean().default(false),
  // Schemastery's dict schemas carry `{}` as their implicit default.
  steps: z.dict(z.union(['done', 'skipped']), z.union(ONBOARDING_STEP_IDS)),
  completedAt: z.string(),
})

/**
 * Register the onboarding section when a settings provider is composed; an
 * invalid stored section fails the registration itself (the earliest point
 * the schema can judge it). The routes mount when their services compose.
 * @param ctx - Host context that may acquire the settings service.
 * @param config - endpoint overrides.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE), OnboardingSettingsSchema)
  })
  installOnboardingRoutes(ctx, config.openrouterBaseURL ?? OPENROUTER_API_BASE)
}
