/**
 * The IDEalize brand token sheet. The two palettes are the IDEalize preset's:
 * IDEalize Light (#FFFFFF ground / #1B1F24 ink / #0969DA blue, crisp
 * dividers) and V0's IDEalize Dark (#2A2F35 ground / #D5DDE3 ink / #85C1B4
 * sage). Every
 * derived surface comes from `@idealize/appearance`'s `deriveTokens`, the same
 * derivation the appearance panel lays for the IDEalize preset and for every
 * other preset, so the sheet and the panel's layer carry one token list
 * (`PRESET_TOKEN_KEYS`) with equal values: choosing IDEalize in the panel
 * repaints exactly what this sheet paints, and no other preset leaves a
 * token this sheet set.
 *
 * The sheet redefines those tokens, the code font token, and the
 * `--idealize-type-*` pane type scale, on the same `body` /
 * `body[data-ds-dark-theme]` scopes design-platform.css uses. Injected into
 * the served index after the opening body tag, it follows the head-linked
 * token sheets in document order, so equal-specificity redefinitions here
 * win. The error, warning and success text colours are design-platform's
 * seeds deepened along their hue until they read on each ground.
 */

import { deriveTokens, presetPalette, tokenDeclarations } from '@idealize/appearance'
import { splashMarkup } from './splash.ts'

/** The id of the injected `<style>` element. */
export const SKIN_STYLE_ID = 'idealize-skin'

/** The brand token sheet's CSS text. */
export const SKIN_CSS = `
body {
  /* IDEalize Light — derived from the white ground, #1B1F24 ink and #0969DA accent, crisp dividers */
${tokenDeclarations(deriveTokens(presetPalette('idealize', 'light')))}
  /* V0 type: system UI face, DM Mono for code */
  --ds-font-family-code: 'DM Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code',
    Consolas, monospace;
  /* IDEalize pane type scale. Family rides --dsw-font-family (the appearance
     panel's interface font rewrites that token) and the interface size zooms
     #root, so panes on these steps follow both settings. */
  --idealize-type-title: 14px;
  --idealize-type-section: 13px;
  --idealize-type-body: 12.5px;
  --idealize-type-small: 11.5px;
  --idealize-type-caption: 10px;
}

body[data-ds-dark-theme] {
  /* IDEalize Dark — derived from the ground, ink and #85C1B4 sage accent; dark ink on sage fills */
${tokenDeclarations(deriveTokens(presetPalette('idealize', 'dark')))}
}
`

/**
 * Insert the skin style block immediately after the opening body tag, after
 * any earlier body-start injections (the ui-theme boot script), so the sheet
 * follows every head-linked token stylesheet in document order.
 * @param html - Raw application index HTML.
 * @returns HTML containing the skin stylesheet.
 */
export function injectSkin(html: string): string {
  const style = `<style id="${SKIN_STYLE_ID}">${SKIN_CSS}</style>${splashMarkup()}`
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${style}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${style}${html.slice(at)}`
}
