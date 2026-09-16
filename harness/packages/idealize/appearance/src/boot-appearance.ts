/**
 * Host-rendered appearance bootstrap for the browser's pre-plugin interval:
 * the interface font and size land with the index response, so the shell
 * never paints one frame at the default before the client plugin applies the
 * stored values. Colours need no bootstrap here — the ui-theme boot script
 * already picks the palette attribute, and the preset layer follows with the
 * plugin tree.
 */

import {
  APPEARANCE_DEFAULTS, fontStack, uiScale, type AppearanceSettings,
} from './appearance-settings.ts'

/** Id of the injected style element (the client applier leaves it in place; its values are overridden inline). */
export const BOOT_STYLE_ID = 'idealize-appearance-boot'

/** Build the inline style for one schema-validated section. */
function bootMarkup(settings: AppearanceSettings): string {
  const font = settings.uiFont.trim() === '' ? '' : `body{--dsw-font-family:${fontStack(settings.uiFont).replaceAll('<', '')}}`
  const scale = uiScale(settings.uiSize)
  const zoom = scale === 1 ? '' : `#root{zoom:${scale}}`
  return `<style id="${BOOT_STYLE_ID}">${font}${zoom}</style>`
}

/**
 * Insert the appearance bootstrap immediately after the opening body tag.
 * Body-less fragments receive it at the end, where the HTML parser has
 * already synthesized a body.
 * @param html - Raw application index HTML.
 * @param settings - Current Host-backed appearance section.
 * @returns HTML containing the bootstrap.
 */
export function injectBootAppearance(html: string, settings: AppearanceSettings = APPEARANCE_DEFAULTS): string {
  const markup = bootMarkup(settings)
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${markup}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${markup}${html.slice(at)}`
}
