/**
 * @idealize/onboarding — first-run onboarding, host half: the durable
 * `idealize-onboarding` settings section and the wizard's detection/save
 * routes. The browser half renders the five-step wizard (set-up, projects
 * folder, documentation folder, skills folder, finish) gated by this section,
 * exactly as the tour is gated by `idealize-tour.hasSeenTour`: `done` closes
 * the flow for good, `steps` records each step's outcome so a relaunch
 * resumes where the user left off, `completedAt` timestamps a completed
 * run, and `simplerSeen` records that the person has seen the three-part
 * set-up (in the wizard, or on the welcome sheet shown once after an update).
 *
 * Routes (loopback-fenced; the mutations demand the `x-idealize-auth`
 * header; see ./routes.ts):
 * - `GET  /idealize/onboarding/agents` — Claude Code CLI detection (through
 *   the subprocess seam's executable resolution), OpenRouter and fal
 *   credential presence, and the Terminal's default launch command.
 * - `POST /idealize/onboarding/align` — store the chosen coding app as the
 *   Terminal's default launch command and point the default chat model at the
 *   same company's model on OpenRouter.
 * - `POST /idealize/onboarding/openrouter` — verify-then-store an OpenRouter
 *   key: the credential plus the `openrouter` provider route's `apiKeyEnv`
 *   binding in the `llm-pi-ai` section (the only write a catalog route needs).
 * The folder steps reuse @idealize/setup's routes.
 *
 * @module @idealize/onboarding
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { STORED_STEP_IDS } from './step-ids.ts'
import { installOnboardingRoutes } from './routes.ts'

export { ONBOARDING_STEP_IDS } from './step-ids.ts'
export type { OnboardingStepId, OnboardingStepOutcome } from './step-ids.ts'
export { OPENROUTER_KEY_ENV } from './routes.ts'
import type { OnboardingStepOutcome } from './step-ids.ts'

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
  steps: Record<(typeof STORED_STEP_IDS)[number], OnboardingStepOutcome>
  /** When the flow completed (ISO); a skip-all leaves it absent. */
  completedAt?: string
  /**
   * True once the person has seen the three-part set-up: at the end of the
   * wizard, or when the welcome sheet closes. A section stored before this
   * field existed reads false, which is what shows the sheet after an update.
   */
  simplerSeen: boolean
}

/** Runtime schema for {@link OnboardingSettings}. */
export const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  done: z.boolean().default(false),
  // Schemastery's dict schemas carry `{}` as their implicit default.
  steps: z.dict(z.union(['done', 'skipped']), z.union(STORED_STEP_IDS)),
  completedAt: z.string(),
  simplerSeen: z.boolean().default(false),
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
