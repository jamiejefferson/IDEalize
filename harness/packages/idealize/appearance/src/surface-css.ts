/**
 * The per-surface and chat-panel projection as CSS text (V0 PanelStyle and
 * ActionStyle, expressed as a stylesheet over the `data-idealize-surface`
 * hooks the frame and the conversation column carry). Pure: settings in,
 * stylesheet out; the client applies it through one `<style>` element.
 *
 * Typography: the font family, letter-spacing and weight cascade from the
 * surface root (code keeps its own face); size is a zoom relative to the
 * surface's natural size, as V0 scaled per-panel type by `fontSize / base`;
 * the text colour rewrites the surface's ink tokens (secondary at 55%, V0's
 * `secondaryTextColor`). Background: the surface root paints the fill and
 * its own ground tokens go transparent so nothing inside covers it. Both
 * colours paint only in the scheme they were chosen in (`surfaceScheme`);
 * the other scheme keeps the theme's own. On a fill of its own, the surface's
 * ink tokens are held to a contrast floor against it ({@link surfaceInk}).
 */

import {
  blend, contrast, deepenAgainstAll, deepenAlongHue, fromHsl, parseHex, requireHex, TEXT_CONTRAST, toHex, toHsl, toRgba, UI_CONTRAST,
  type Rgb,
} from './colour.ts'
import {
  type ActionAppearance, type GradientStop, type GradientType, type SurfaceAppearance, type SurfaceId, fontStack,
  FONT_WEIGHTS, SURFACES, surfaceScheme,
} from './appearance-settings.ts'
import { onFill, type Tokens } from './presets.ts'

/** Each surface's natural text size, the divisor of its size override (V0 PanelStyle.baseSize). */
export const SURFACE_BASE_SIZE: Readonly<Record<SurfaceId, number>> = Object.freeze({
  sessions: 13,
  files: 12,
  chat: 16,
  doc: 14,
})

/**
 * Each surface's unstressed body leading as an em ratio, the base the
 * line-spacing slider adds onto (spacing 0 leaves the surface exactly as
 * shipped). Chat is the assistant flow's 16px/28px
 * (AssistantMarkdown.module.css); the other surfaces set no explicit body
 * line-height, so they render at the browser's `normal` (~1.45), which the
 * rail's 13/18 and 14/20 rows sit on.
 */
export const SURFACE_BASE_LEADING: Readonly<Record<SurfaceId, number>> = Object.freeze({
  sessions: 1.45,
  files: 1.45,
  chat: 1.75,
  doc: 1.45,
})

/** The user bubble's 16px/24px leading (MessageItem.module.css), the base of the `[data-message-text]` rule. */
const BUBBLE_LEADING = 1.5

/** Attribute the frame and conversation column mark their surfaces with. */
export const SURFACE_ATTRIBUTE = 'data-idealize-surface'

/**
 * Attribute an element inside a surface carries to keep the surface's
 * typography and ink off itself and its subtree: the appearance panel sets it
 * on its root so it stays legible while the person edits the surface hosting it.
 */
export const SURFACE_EXEMPT_ATTRIBUTE = 'data-idealize-surface-exempt'

/** Attribute the conversation's composer card already carries. */
export const COMPOSER_ATTRIBUTE = 'data-composer-card'

/** Attribute the conversation's sticky composer seat already carries. */
export const COMPOSER_SEAT_ATTRIBUTE = 'data-composer-seat'

/**
 * How far the seat's blur reaches, and over how tall a band it comes in. The
 * band matches the seat's own transcript fade (ConversationRoot.module.css:
 * a fixed 36px), so the blur arrives exactly where the fade used to.
 */
const SEAT_BLUR_PX = 14
const SEAT_FADE_PX = 36

/**
 * The rule that masks the transcript under the composer on a surface painting
 * its own background.
 *
 * The conversation seat fades the transcript out against `--dsw-alias-bg-base`.
 * A surface with a fill of its own paints that fill on the surface root and
 * sets `--dsw-alias-bg-base: transparent` so nothing inside covers it, which
 * leaves that fade fading to nothing: the transcript stayed legible under the
 * card and collided with the stats line below it (JJ, 10 Sep 2026). A blurred
 * backdrop masks over any ground, custom or not, so it replaces the fade
 * wherever this sheet takes the ground token away.
 *
 * The active phase carries it because that is the only phase where the seat
 * is positioned (`ConversationRoot.module.css` makes it sticky there) and so
 * the only phase where `inset: 0` is bounded by the seat. On the hero screen
 * the seat is static, and without this scope the blur resolved against the
 * viewport and frosted the whole window (JJ, 11 Sep 2026: "why is everything
 * blurred!?"). It is also the only phase with a transcript to mask. The phase
 * attribute sits on the conversation root, which IS the chat surface root, so
 * it compounds onto `root` rather than descending from it.
 *
 * The layer sits at `z-index: -1` inside the seat's stacking context (the
 * active seat is sticky with a z-index), so it paints under every composer
 * entry the seat holds. As a positioned box at auto z-index it painted over
 * any entry that is not itself positioned: the InputBar card is, the approval
 * takeover is not, and an approval arriving over a custom chat ground came up
 * frosted with its Allow button unreadable (JJ, 15 Sep 2026: "the ask bar has
 * suddenly broken").
 * @param root - the surface's own doubled selector.
 * @returns the seat rule.
 */
function seatBlurRule(root: string): string {
  const mask = `linear-gradient(180deg, transparent 0px, #000 ${String(SEAT_FADE_PX)}px)`
  return `${root}[data-phase='active'] [${COMPOSER_SEAT_ATTRIBUTE}]::before {`
    + ' content: \'\';'
    + ' position: absolute;'
    + ' inset: 0;'
    + ' z-index: -1;'
    + ' pointer-events: none;'
    + ` backdrop-filter: blur(${String(SEAT_BLUR_PX)}px);`
    + ` -webkit-backdrop-filter: blur(${String(SEAT_BLUR_PX)}px);`
    + ` mask-image: ${mask};`
    + ` -webkit-mask-image: ${mask};`
    + ' }'
}

/** The `:not()` arguments that keep a descendant rule off an exempt subtree. */
const EXEMPT_NOT = `[${SURFACE_EXEMPT_ATTRIBUTE}], [${SURFACE_EXEMPT_ATTRIBUTE}] *`

/** The ink tokens a surface text colour rewrites and an exempt subtree restores. */
const INK_TOKENS = ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption'] as const

/** Doubled attribute selector: beats a CSS-module class on specificity regardless of sheet order. */
function surfaceSelector(id: SurfaceId): string {
  return `[${SURFACE_ATTRIBUTE}="${id}"][${SURFACE_ATTRIBUTE}]`
}

/** A colour at an opacity: plain hex when opaque, rgba() otherwise. */
function paint(rgb: Rgb, alpha: number): string {
  return alpha >= 1 ? toHex(rgb) : toRgba(rgb, alpha)
}

/**
 * One colour stop as CSS, the opacity folded into the colour (V0 applied the
 * opacity to the whole fill).
 */
function stopCss(stop: GradientStop, opacity: number, fallback: string): string {
  const rgb = parseHex(stop.colorHex) ?? parseHex(fallback) ?? { r: 136, g: 136, b: 136 }
  const location = Math.round(Math.min(1, Math.max(0, stop.location)) * 1000) / 10
  return `${paint(rgb, opacity)} ${location}%`
}

/**
 * A CSS gradient image for stops, shape and angle (V0 makeGradientStyle).
 * @param stops - colour stops, any order.
 * @param type - gradient shape.
 * @param angle - degrees, used by linear and angular.
 * @param opacity - 0–1 folded into every stop.
 * @param fallback - hex used for a stop whose colour does not parse.
 * @returns the gradient image value.
 */
export function gradientCss(stops: readonly GradientStop[], type: GradientType, angle: number, opacity: number, fallback: string): string {
  const sorted = [...stops].sort((a, b) => a.location - b.location)
  const list = (sorted.length === 0 ? [{ colorHex: fallback, location: 0 }, { colorHex: fallback, location: 1 }] : sorted)
    .map(stop => stopCss(stop, opacity, fallback)).join(', ')
  switch (type) {
    case 'linear':
      // V0 measures from the positive x axis; CSS measures from the top.
      return `linear-gradient(${(angle + 90) % 360}deg, ${list})`
    case 'radial':
      return `radial-gradient(circle at center, ${list})`
    case 'angular':
      return `conic-gradient(from ${angle}deg at center, ${list})`
  }
}

/**
 * Seed stops from two colours (V0 defaultStops).
 * @param first - hex at 0.
 * @param second - hex at 1.
 * @returns the two stops.
 */
export function seedStops(first: string, second: string): GradientStop[] {
  return [{ colorHex: first, location: 0 }, { colorHex: second, location: 1 }]
}

/** The theme values a surface falls back to when it inherits. */
export interface SurfaceDefaults {
  /** Theme ground hex (gradient seed start). */
  ground: string
  /** Theme surface hex (gradient seed end). */
  surface: string
  /** The scheme's resolved layer: an exempt subtree takes its ink tokens back from here. */
  tokens: Tokens
  /** The scheme being painted; a surface's colours apply only when they belong to it. */
  scheme: 'light' | 'dark'
}

/** A resolved layer token; the layer always carries every {@link INK_TOKENS} member. */
function requireInk(tokens: Tokens, name: typeof INK_TOKENS[number]): string {
  const value = tokens[name]
  if (value === undefined) throw new Error(`the resolved layer carries no ${name}`)
  return value
}

/**
 * The contrast each ink token holds against a surface's own ground: primary
 * carries running text; secondary, tertiary and caption carry icons, chip
 * labels, placeholders and small notes. {@link surfaceInk} lowers a floor to
 * what the theme's own token holds on the theme's own ground where that is
 * less (IDEalize Light's 45% tertiary sits at 2.8:1 on white), so a surface's
 * ground never makes ink fainter than the theme has it, and a theme's faint
 * ink is not second-guessed.
 */
export const INK_FLOORS: Readonly<Record<typeof INK_TOKENS[number], number>> = Object.freeze({
  '--dsw-alias-label-primary': TEXT_CONTRAST,
  '--dsw-alias-label-secondary': UI_CONTRAST,
  '--dsw-alias-label-tertiary': UI_CONTRAST,
  '--dsw-alias-label-caption': UI_CONTRAST,
})

/** The opacity a surface text colour takes in each ink token (V0 `secondaryTextColor` is the 55%). */
const INK_ALPHAS: Readonly<Record<typeof INK_TOKENS[number], number>> = Object.freeze({
  '--dsw-alias-label-primary': 1,
  '--dsw-alias-label-secondary': 0.55,
  '--dsw-alias-label-tertiary': 0.45,
  '--dsw-alias-label-caption': 0.55,
})

/** A layer token as colour and opacity: `#RRGGBB` or the `rgba()` form {@link toRgba} writes. */
function parseToken(value: string): { rgb: Rgb; alpha: number } | undefined {
  const hex = parseHex(value)
  if (hex !== undefined) return { rgb: hex, alpha: 1 }
  const match = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(value)
  if (match === null) return undefined
  const [r, g, b, alpha] = match.slice(1).map(Number) as [number, number, number, number]
  return { rgb: { r, g, b }, alpha }
}

/**
 * The opaque colours a surface's own background paints, each composited over
 * the theme ground at the background's opacity: one for a solid fill, one per
 * stop for a gradient.
 * @param surface - override.
 * @param defaults - theme fallbacks.
 * @returns the grounds, or undefined when the surface paints none in this scheme.
 */
export function surfaceGrounds(surface: SurfaceAppearance, defaults: SurfaceDefaults): Rgb[] | undefined {
  if (surfaceScheme(surface) !== defaults.scheme || surface.bgMode === 'inherit') return undefined
  const under = parseHex(defaults.ground)
  if (under === undefined) return undefined
  const gradient = surface.bgGradientStops.length > 0 ? surface.bgGradientStops : seedStops(defaults.ground, defaults.surface)
  const stops = surface.bgMode === 'solid' ? [surface.bgColorHex] : gradient.map(stop => stop.colorHex)
  return stops.map(hex => blend(under, parseHex(hex) ?? under, surface.bgOpacity))
}

/** One ink token held to its floor. */
export interface FlooredInk {
  /** CSS value: the source value when it already reads, otherwise the opaque deepened colour. */
  value: string
  /** Lowest contrast of the source colour across the grounds. */
  ratio: number
  /** Lowest contrast of {@link value} across the grounds; below the floor only when no shade of the hue reaches it. */
  painted: number
  /** Whether the value was deepened along its hue. */
  deepened: boolean
}

/**
 * Hold a surface's ink tokens to {@link INK_FLOORS} against a set of grounds,
 * each floor capped at the ratio the theme's own token holds on the theme
 * ground. The source of each token is the surface's text colour at the token's
 * opacity, or the theme's own token when the surface sets no text colour. A
 * source that reads on every ground stands; one that does not restarts from
 * the lightness it shows at over the ground it reads worst on, in its own hue
 * and saturation, and is deepened ({@link deepenAgainstAll}) until it does. Nothing is desaturated or swapped.
 * The stylesheet and the panel's readout share this.
 * @param surface - override.
 * @param theme - the scheme's ground and resolved layer.
 * @param grounds - the opaque grounds the ink is read against.
 * @returns each ink token floored.
 */
export function surfaceInk(surface: SurfaceAppearance, theme: Pick<SurfaceDefaults, 'ground' | 'tokens'>, grounds: readonly Rgb[]): Record<typeof INK_TOKENS[number], FlooredInk> {
  const own = parseHex(surface.textColorHex)
  const themeGround = requireHex(theme.ground)
  const floored = INK_TOKENS.map((name): [typeof INK_TOKENS[number], FlooredInk] => {
    const token = requireInk(theme.tokens, name)
    const themed = parseToken(token)
    if (themed === undefined) throw new Error(`${name} is neither #RRGGBB nor rgba(): ${JSON.stringify(token)}`)
    const floor = Math.min(INK_FLOORS[name], contrast(blend(themeGround, themed.rgb, themed.alpha), themeGround))
    const source = own === undefined ? themed : { rgb: own, alpha: INK_ALPHAS[name] }
    const seen = grounds.map(ground => ({ ground, colour: blend(ground, source.rgb, source.alpha) }))
    const worst = seen.reduce((a, b) => (contrast(b.colour, b.ground) < contrast(a.colour, a.ground) ? b : a))
    const ratio = contrast(worst.colour, worst.ground)
    const written = own === undefined ? token : paint(own, source.alpha)
    if (ratio >= floor) return [name, { value: written, ratio, painted: ratio, deepened: false }]
    // The walk starts at the lightness the faded ink shows at, in the ink's own hue and saturation: the composite's
    // hue is part ground, and the opaque ink's lightness would flatten a 45% token into the primary.
    const deepened = deepenAgainstAll(fromHsl({ ...toHsl(source.rgb), l: toHsl(worst.colour).l }), grounds, floor)
    const painted = Math.min(...grounds.map(ground => contrast(deepened, ground)))
    return [name, { value: toHex(deepened), ratio, painted, deepened: true }]
  })
  return Object.fromEntries(floored) as Record<typeof INK_TOKENS[number], FlooredInk>
}

/**
 * The rules that keep the composer card's text, icons and caret readable
 * when the chat surface writes its ink. The card paints the theme's own
 * `--dsw-specific-input-major`, so ink chosen or deepened for the surface's
 * ground can vanish on it: a pale ink over a dark chat ground left the
 * card's right-hand icons invisible on a light card (feedback cb68f5d5). Inside
 * the card the ink tokens are held to the same floors against the card's fill.
 *
 * The caret follows the same floored primary ink. Upstream paints it with
 * `--dsw-alias-state-business-primary` (InputBar.module.css), the theme's
 * accent held readable against the theme ground, so with the chat recoloured
 * it stayed the accent while the text around it took the person's ink
 * (feedback dbd36ed7). The textarea sets `caret-color` on itself, so the
 * card's inherited value never reaches it; the second rule names the
 * textarea under the card, and its three attributes and one type beat the
 * upstream class whatever the sheet order. Without a written ink the caret
 * is left to that accent token, which the Appearance action colour rewrites.
 * @param root - the chat surface's doubled selector.
 * @param surface - override.
 * @param theme - the scheme's ground and resolved layer.
 * @returns the card rule and the caret rule, or nothing when the card fill is not a plain colour.
 */
function composerInkRules(root: string, surface: SurfaceAppearance, theme: Pick<SurfaceDefaults, 'ground' | 'tokens'>): string[] {
  const card = parseHex(theme.tokens['--dsw-specific-input-major'] ?? '')
  if (card === undefined) return []
  const floored = surfaceInk(surface, theme, [card])
  const rules = INK_TOKENS.map(name => `${name}: ${floored[name].value}`)
  const primary = floored['--dsw-alias-label-primary'].value
  return [
    `${root} [${COMPOSER_ATTRIBUTE}] { ${rules.join('; ')}; color: ${primary}; caret-color: ${primary}; }`,
    `${root} [${COMPOSER_ATTRIBUTE}] textarea { caret-color: ${primary}; }`,
  ]
}

/**
 * The stylesheet for one surface's override.
 * @param id - surface.
 * @param surface - override.
 * @param defaults - theme fallbacks for gradient seeds.
 * @returns CSS text, empty when the surface inherits everything.
 */
export function surfaceCss(id: SurfaceId, surface: SurfaceAppearance, defaults: SurfaceDefaults): string {
  const root = surfaceSelector(id)
  const rootRules: string[] = []
  const textRules: string[] = []
  // What an exempt subtree undoes: the root's inherited typography and ink.
  const exemptRules: string[] = []
  if (surface.fontName.trim() !== '') {
    rootRules.push(`font-family: ${fontStack(surface.fontName)}`)
    textRules.push(`${root} :not(code, pre, kbd, samp, code *, pre *, ${EXEMPT_NOT}) { font-family: inherit; }`)
    exemptRules.push('font-family: var(--dsw-font-family)')
  }
  if (surface.fontSize > 0) {
    const zoom = Math.round((surface.fontSize / SURFACE_BASE_SIZE[id]) * 1000) / 1000
    rootRules.push(`zoom: ${zoom}`)
    // Nested zoom multiplies, so the reciprocal returns the subtree to 1.
    exemptRules.push(`zoom: ${Math.round((1 / zoom) * 1000) / 1000}`)
  }
  const weight = FONT_WEIGHTS[surface.fontWeight]
  if (weight !== undefined && weight !== 'inherit') {
    rootRules.push(`font-weight: ${weight}`)
    textRules.push(`${root} :not(${EXEMPT_NOT}) { font-weight: inherit; }`)
    exemptRules.push('font-weight: normal')
  }
  if (surface.tracking !== 0) {
    rootRules.push(`letter-spacing: ${surface.tracking}px`)
    exemptRules.push('letter-spacing: normal')
  }
  if (surface.lineSpacing > 0) {
    // Body text only: headings keep their own tighter design leading, and the
    // bubble hook covers MessageText, whose line-height is `inherit`.
    textRules.push(`${root} :is(p, li, blockquote, td, dd):not(${EXEMPT_NOT}) { line-height: calc(${SURFACE_BASE_LEADING[id]}em + ${surface.lineSpacing}px); }`)
    textRules.push(`${root} [data-message-text]:not(${EXEMPT_NOT}) { line-height: calc(${BUBBLE_LEADING}em + ${surface.lineSpacing}px); }`)
  }
  // Colours chosen over the other scheme stay out of this one's sheet.
  const coloursApply = surfaceScheme(surface) === defaults.scheme
  const ink = coloursApply ? parseHex(surface.textColorHex) : undefined
  const grounds = surfaceGrounds(surface, defaults)
  // On a ground of its own the ink is held to the floors, whoever chose it; a
  // text colour over the theme's ground is written as chosen.
  const floored = grounds === undefined ? undefined : surfaceInk(surface, defaults, grounds)
  // A surface with no text colour writes only the tokens it had to deepen; the rest stay the theme's.
  const written: [typeof INK_TOKENS[number], string][] = floored !== undefined
    ? INK_TOKENS.filter(name => ink !== undefined || floored[name].deepened).map(name => [name, floored[name].value])
    : ink !== undefined
      ? INK_TOKENS.map(name => [name, paint(ink, INK_ALPHAS[name])])
      : []
  if (written.length > 0) {
    rootRules.push(...written.map(([name, value]) => `${name}: ${value}`))
    const primary = written.find(([name]) => name === '--dsw-alias-label-primary')
    if (primary !== undefined) rootRules.push(`color: ${primary[1]}`)
    exemptRules.push(...INK_TOKENS.map(name => `${name}: ${requireInk(defaults.tokens, name)}`), 'color: var(--dsw-alias-label-primary)')
  }
  let paintsOwnGround = false
  if (!coloursApply) {
    // Nothing: the theme's ground and ink stand.
  } else if (surface.bgMode === 'solid') {
    const fill = parseHex(surface.bgColorHex) ?? parseHex(defaults.ground)
    if (fill !== undefined) {
      rootRules.push(`background: ${paint(fill, surface.bgOpacity)}`, '--dsw-alias-bg-base: transparent', '--dsw-specific-sidebar-fill: transparent')
      paintsOwnGround = true
    }
  } else if (surface.bgMode === 'gradient') {
    const stops = surface.bgGradientStops.length > 0 ? surface.bgGradientStops : seedStops(defaults.ground, defaults.surface)
    rootRules.push(
      `background: ${gradientCss(stops, surface.bgGradientType, surface.gradientAngle, surface.bgOpacity, defaults.ground)}`,
      '--dsw-alias-bg-base: transparent',
      '--dsw-specific-sidebar-fill: transparent',
    )
    paintsOwnGround = true
  }
  // The chat surface is the only one holding a composer, so it is the only one
  // whose transcript can run under one.
  if (paintsOwnGround && id === 'chat') textRules.push(seatBlurRule(root))
  if (written.length > 0 && id === 'chat') textRules.push(...composerInkRules(root, surface, defaults))
  if (rootRules.length === 0 && textRules.length === 0) return ''
  if (exemptRules.length > 0) textRules.push(`${root} [${SURFACE_EXEMPT_ATTRIBUTE}] { ${exemptRules.join('; ')}; }`)
  const rootBlock = rootRules.length === 0 ? '' : `${root} { ${rootRules.join('; ')}; }\n`
  return `${rootBlock}${textRules.join('\n')}${textRules.length === 0 ? '' : '\n'}`
}

/** The accent the action colour yields for text, borders and icons. */
export interface ActionAccent {
  /** CSS colour: the person's colour at their opacity when that reads, otherwise the opaque deepened shade. */
  value: string
  /** The person's colour composited over the ground at their opacity. */
  composite: Rgb
  /** Contrast of the composite against the ground. */
  ratio: number
  /** Whether the value was deepened along its hue to reach {@link UI_CONTRAST}. */
  deepened: boolean
}

/**
 * The accent an action colour gives to text, borders and icons: the colour at
 * the chosen opacity when its composite over the ground reads at 3:1,
 * otherwise the solid colour deepened along its hue until it does. The panel's
 * readout and {@link actionTokens} share this so what the readout says is
 * what the borders paint.
 * @param solid - the action colour.
 * @param opacity - the action opacity 0–1.
 * @param ground - the scheme's ground.
 * @returns the accent, its composite ratio and whether it was deepened.
 */
export function actionAccent(solid: Rgb, opacity: number, ground: Rgb): ActionAccent {
  const composite = blend(ground, solid, opacity)
  const ratio = contrast(composite, ground)
  if (ratio >= UI_CONTRAST) return { value: paint(solid, opacity), composite, ratio, deepened: false }
  return { value: toHex(deepenAlongHue(solid, ground, UI_CONTRAST)), composite, ratio, deepened: true }
}

/**
 * The action colour as token overrides (V0 ActionStyle.fill / softFill): the
 * button fills (`button-primary` and the send circle's `button-info` pair)
 * take the solid colour or the gradient image at the action's opacity; the
 * soft selection fills take the solid colour at 18% and 12%; the accent used
 * as text, borders, icons and the composer/tab highlights
 * (`--dsw-alias-brand-primary`, `--dsw-alias-state-business-primary`) takes
 * {@link actionAccent}, so every accent border agrees with the buttons. With
 * an ink, the text written on the fill (`brand-primary-invert`) is whichever
 * of ink and ground reads better on it.
 * @param action - the action appearance.
 * @param accent - the theme accent hex the action falls back to.
 * @param ground - the scheme's ground hex the deepen rule reads against.
 * @param ink - the scheme's ink hex; without it the fill's text token is left to the layer.
 * @returns token name → CSS value, empty when neither the action nor the accent parses.
 */
export function actionTokens(action: ActionAppearance, accent: string, ground: string, ink?: string): Record<string, string> {
  const solidHex = parseHex(action.colorHex) === undefined ? accent : action.colorHex.toUpperCase()
  const solid = parseHex(solidHex)
  if (solid === undefined) return {}
  const tokens: Record<string, string> = {}
  if (action.mode === 'gradient') {
    const stops = action.gradientStops.length > 0 ? action.gradientStops : seedStops(solidHex, solidHex)
    tokens['--dsw-alias-button-primary-fill'] = gradientCss(stops, action.gradientType, action.angle, action.opacity, solidHex)
    tokens['--dsw-alias-button-primary-hover'] = gradientCss(stops, action.gradientType, action.angle, Math.min(1, action.opacity * 0.85), solidHex)
  } else {
    tokens['--dsw-alias-button-primary-fill'] = paint(solid, action.opacity)
    tokens['--dsw-alias-button-primary-hover'] = toRgba(solid, Math.min(1, action.opacity * 0.85))
  }
  // The send button reads the info pair, not button-primary (InputBar.module.css).
  tokens['--dsw-alias-button-info-fill'] = requireToken(tokens, '--dsw-alias-button-primary-fill')
  tokens['--dsw-alias-button-info-hover'] = requireToken(tokens, '--dsw-alias-button-primary-hover')
  tokens['--dsw-alias-interactive-bg-hover-accent'] = toRgba(solid, 0.18 * action.opacity)
  tokens['--dsw-alias-interactive-bg-active'] = toRgba(solid, 0.12 * action.opacity)
  tokens['--dsw-alias-button-primary-dimmed'] = toRgba(solid, 0.45 * action.opacity)
  tokens['--dsw-alias-state-business-tertiary'] = toRgba(solid, 0.14 * action.opacity)
  const groundRgb = parseHex(ground)
  if (groundRgb !== undefined) {
    const text = actionAccent(solid, action.opacity, groundRgb)
    tokens['--dsw-alias-brand-primary'] = text.value
    tokens['--dsw-alias-state-business-primary'] = text.value
    const inkRgb = ink === undefined ? undefined : parseHex(ink)
    if (inkRgb !== undefined) tokens['--dsw-alias-brand-primary-invert'] = toHex(onFill(text.composite, inkRgb, groundRgb))
  }
  return tokens
}

/** A token just written into the dictionary. */
function requireToken(tokens: Record<string, string>, name: string): string {
  const value = tokens[name]
  /* v8 ignore next -- both branches above write the token before this reads it. */
  if (value === undefined) throw new Error(`actionTokens wrote no ${name}`)
  return value
}

/**
 * The panel scalars a surface's own card asks for beyond typography and
 * background (V0 Chat ▸ Chat panel card, plus the document view's margin).
 */
export interface PanelScalars {
  chatInputOpacity: number
  chatShadowOpacity: number
  chatMargin: number
  docMargin: number
}

/**
 * The panel-scalar stylesheet: each margin feeds its column's spacing
 * variable, and the chat's opacity and shadow land on the composer card.
 * @param panels - the scalars.
 * @returns CSS text.
 */
export function panelScalarsCss(panels: PanelScalars): string {
  const rules: string[] = []
  if (panels.chatMargin !== 18) {
    rules.push(`${surfaceSelector('chat')} { --idealize-chat-pad: ${panels.chatMargin}px; --idealize-chat-gap: ${panels.chatMargin}px; --dsh-composer-side-clearance: ${Math.max(0, panels.chatMargin - 2)}px; }`)
  }
  if (panels.docMargin !== 14) {
    rules.push(`${surfaceSelector('doc')} { --idealize-doc-pad: ${panels.docMargin}px; }`)
  }
  const card: string[] = []
  if (panels.chatInputOpacity !== 1) card.push(`opacity: ${panels.chatInputOpacity}`)
  if (panels.chatShadowOpacity !== 0.4) card.push(`box-shadow: 0 8px 28px rgba(0, 0, 0, ${Math.round(panels.chatShadowOpacity * 0.45 * 100) / 100})`)
  if (card.length > 0) rules.push(`[${COMPOSER_ATTRIBUTE}][${COMPOSER_ATTRIBUTE}] { ${card.join('; ')}; }`)
  return rules.join('\n')
}

/**
 * The whole per-surface + chat stylesheet.
 * @param surfaces - every surface's override.
 * @param panels - the per-panel scalars.
 * @param defaults - theme fallbacks for gradient seeds.
 * @returns CSS text.
 */
export function appearanceStylesheet(
  surfaces: Readonly<Record<SurfaceId, SurfaceAppearance>>,
  panels: PanelScalars,
  defaults: SurfaceDefaults,
): string {
  return [...SURFACES.map(id => surfaceCss(id, surfaces[id], defaults)), panelScalarsCss(panels)].filter(text => text !== '').join('\n')
}
