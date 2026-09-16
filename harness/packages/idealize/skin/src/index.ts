/**
 * @idealize/skin — Host registration for the IDEalize brand token sheet.
 * Transforms the served index like ui-theme's boot script does; the sheet
 * itself lives in ./skin-css.ts.
 * @module @idealize/skin
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { injectSkin } from './skin-css.ts'
import { OWL_FRAMES } from './splash-frames.ts'
import { suppressUpstreamWelcomeNotice } from './welcome-ack.ts'

export { injectSkin, SKIN_CSS, SKIN_STYLE_ID } from './skin-css.ts'
/** The 42 owl run-cycle frames (190×210 WebP data URIs) the boot splash plays. */
export { OWL_FRAMES as SPLASH_FRAMES } from './splash-frames.ts'

const [firstFrame] = OWL_FRAMES
/* v8 ignore next -- the frame list is a non-empty module constant; the guard only types the indexed read. */
if (firstFrame === undefined) throw new Error('idealize-skin: the owl frame list is empty')

/** The owl at rest: the run cycle's first frame, for still marks such as the Askbar's Studio tile. */
export const OWL_FRAME_STILL: string = firstFrame

/**
 * Register the index transform when the webserver is composed, and stand
 * down upstream's first-run notice (IDEalize owns the first-run moment).
 * @param ctx - Host context that may acquire the HTTP service.
 */
export function apply(ctx: Context): void {
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectSkin(html)),
      'idealize-skin: brand token stylesheet',
    )
  })
  suppressUpstreamWelcomeNotice(ctx)
}
