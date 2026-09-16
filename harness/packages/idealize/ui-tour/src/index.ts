/**
 * @idealize/ui-tour — Host half: the durable `idealize-tour` settings section.
 * The browser half reads and writes it through `ctx.settingsScope`; the only
 * field is the one-time seed that keeps the first-run tour from replaying.
 * @module @idealize/ui-tour
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace shared by both halves. */
export const TOUR_SETTINGS_NAMESPACE = 'idealize-tour'

/** The durable section. */
export interface TourSettings {
  /** True once the showcase tour has run or been skipped. */
  hasSeenTour?: boolean
}

const TourSettingsSchema: z<TourSettings> = z.object({
  hasSeenTour: z.boolean(),
})

/**
 * Register the tour section when a settings provider is composed.
 * @param ctx - Host context that may acquire the settings service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(settingsNamespace(TOUR_SETTINGS_NAMESPACE), TourSettingsSchema)
  })
}
