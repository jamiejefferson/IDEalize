/**
 * Pre-acknowledge upstream's "Internal Testing Notice" so IDEalize users
 * never see DeepSeek's developer-testing dialog — the boot splash and the
 * IDEalize identity own the first-run moment. Constants mirror
 * `packages/client/ui-settings-models/src/onboarding-copy.ts` (that module is
 * bundled into the client artifact, so the values are restated here); if
 * upstream bumps the notice version the dialog reappears once and this file
 * follows.
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

const ONBOARDING_NS = settingsNamespace('ui-onboarding')
const ACK_FIELD = 'welcomeNoticeVersion'
const NOTICE_VERSION = '2026-08-13.1'

/**
 * Write the acknowledgement once, only when the user has none stored — a
 * user who later acknowledges a newer notice is never overwritten.
 * @param ctx - Host context that may acquire the settings service.
 */
export function suppressUpstreamWelcomeNotice(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const section = settingsCtx.settings.get(ONBOARDING_NS) as Record<string, unknown> | undefined
      if (section?.[ACK_FIELD] === undefined) {
        settingsCtx.settings.update(ONBOARDING_NS, { [ACK_FIELD]: NOTICE_VERSION }).catch((error: unknown) => {
          settingsCtx.logger.warn('idealize-skin: welcome-notice pre-ack failed', error)
        })
      }
      return () => {}
    }, 'idealize-skin: pre-acknowledge upstream welcome notice')
  })
}
