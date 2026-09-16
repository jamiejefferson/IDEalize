/**
 * App presets and the token derivation shared by presets, the brand skin and
 * the user's own colours. A preset is a ground, an ink and an accent per
 * colour scheme (V0's Theme.swift values); every `--dsw-alias-*` surface
 * derives from those three through V0's blend fractions, so a preset, the
 * shipped skin and a custom palette are built the same way and the
 * readability rule applies to all of them.
 *
 * Every derivation emits exactly {@link PRESET_TOKEN_KEYS}: one preset never
 * leaves a token another preset or the skin set, so switching presets repaints
 * every themed surface.
 */

import {
  blend, contrast, deepenAlongHue, isDark, parseHex, requireHex, TEXT_CONTRAST, toHex, toRgba, UI_CONTRAST, type Rgb,
} from './colour.ts'
import type { PresetId } from './appearance-settings.ts'

/** The three seeds a scheme derives from. */
export interface Palette {
  /** Ground (`--dsw-alias-bg-base`). */
  ground: string
  /** Ink (`--dsw-alias-label-primary`). */
  ink: string
  /** Accent (brand and button fill). */
  accent: string
  /** Plain ground: every surface and the sidebar paint the ground itself. */
  flat?: boolean
  /**
   * Crisper contrast: every `--dsw-alias-border-l*` alpha rises by
   * {@link CRISP_BORDER_STEP} and the secondary label blends
   * {@link CRISP_SECONDARY_BLEND} toward the ground (V0's plain blend is
   * .30), so dividers and captions read heavier on the same ground.
   */
  crisp?: boolean
}

/** One preset: a palette per colour scheme. */
export interface Preset {
  id: PresetId
  light: Palette
  dark: Palette
  /**
   * The scheme a preset chooses when the user picks it. `system` keeps the
   * user's mode and swaps between the two palettes.
   */
  scheme: 'light' | 'dark' | 'system'
}

/**
 * IDEalize Light / Dark; the shipped skin (`@idealize/skin`) derives its sheet
 * from these same seeds. Light is JJ's "pure white, crisper contrast" default
 * (8 Sep 2026): a white ground, a near-black ink that reads at 16.6:1, V0's
 * #0969DA as the single accent, and `crisp` dividers. Dark keeps V0's
 * Theme.swift values.
 */
const IDEALIZE_LIGHT: Palette = { ground: '#FFFFFF', ink: '#1B1F24', accent: '#0969DA', crisp: true }
const IDEALIZE_DARK: Palette = { ground: '#2A2F35', ink: '#D5DDE3', accent: '#85C1B4' }

/** Ink — V0's editorial warm-neutral dark: #17181A ground, #E6E7E9 ink, gold #E8B84B. */
const INK: Palette = { ground: '#17181A', ink: '#E6E7E9', accent: '#E8B84B' }

/** Linen — the light side of Ink: warm paper #F7F5F0, #2A2A27 ink, ochre #B67A12. */
const LINEN: Palette = { ground: '#F7F5F0', ink: '#2A2A27', accent: '#B67A12' }

/** OG — the plain ground: flat white or flat near-black, ink-coloured buttons. */
const OG_LIGHT: Palette = { ground: '#FFFFFF', ink: '#1F2328', accent: '#1F2328', flat: true }
const OG_DARK: Palette = { ground: '#1B1D21', ink: '#E8E9EB', accent: '#E8E9EB', flat: true }

/** Presets in panel order. */
export const PRESET_LIST: readonly Preset[] = Object.freeze([
  { id: 'idealize', light: IDEALIZE_LIGHT, dark: IDEALIZE_DARK, scheme: 'system' },
  { id: 'og', light: OG_LIGHT, dark: OG_DARK, scheme: 'system' },
  { id: 'ink', light: LINEN, dark: INK, scheme: 'dark' },
  { id: 'linen', light: LINEN, dark: INK, scheme: 'light' },
])

/**
 * Look up a preset.
 * @param id - preset id.
 * @returns the preset.
 */
export function preset(id: PresetId): Preset {
  const entry = PRESET_LIST.find(candidate => candidate.id === id)
  if (entry === undefined) throw new Error(`unknown preset ${JSON.stringify(id)}`)
  return entry
}

/**
 * The palette a preset shows in one scheme.
 * @param id - preset id.
 * @param scheme - colour scheme.
 * @returns the palette.
 */
export function presetPalette(id: PresetId, scheme: 'light' | 'dark'): Palette {
  const entry = preset(id)
  return scheme === 'dark' ? entry.dark : entry.light
}

/**
 * Every alias token a theme layer sets, in emission order. The skin sheet and
 * {@link deriveTokens} both cover exactly this list, so no preset leaves a
 * token painted by the one before it.
 */
export const PRESET_TOKEN_KEYS: readonly string[] = Object.freeze([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3',
  '--dsw-alias-bg-overlay',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-bubble',
  '--dsw-specific-bubble-highlight',
  '--dsw-specific-input-major',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-primary-bluish',
  '--dsw-alias-label-primary-dimmed',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption',
  '--dsw-alias-label-dimmed',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-alias-border-l2-darkmode-thin',
  '--dsw-alias-border-l3',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-brand-primary-invert',
  '--dsw-alias-brand-text',
  '--dsw-alias-button-primary-fill',
  '--dsw-alias-button-primary-hover',
  '--dsw-alias-button-primary-dimmed',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-button-info-hover',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-hover-accent',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-state-business-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-warn-label',
  '--dsw-alias-state-success-primary',
  '--dsw-alias-bg-multi-select',
  '--dsw-alias-markdown-inline-code',
  '--dsw-alias-markdown-code-block',
  '--dsw-alias-markdown-code-block-banner',
])

/**
 * design-platform.css's state seeds (red-600 / red-400 by scheme, amber-600,
 * green-500). A layer deepens each along its hue until it reads on its
 * ground: error and warning carry text (4.5:1), success marks dots and ticks
 * (3:1). Stock amber-600 reads at 2.6:1 and green-500 at 2.1:1 on the light
 * grounds, which is why the layer owns them.
 */
const STATE_SEEDS = Object.freeze({
  error: { light: '#EC1313', dark: '#F25A5A' },
  warn: '#DD8629',
  success: '#22C55E',
})

/** Alias-token dictionary for one scheme. */
export type Tokens = Record<string, string>

/** How far a `crisp` palette raises each `--dsw-alias-border-l*` alpha above the V0 value. */
export const CRISP_BORDER_STEP = 0.04

/** How far a `crisp` palette blends the secondary label toward the ground; V0's plain blend is .30. */
export const CRISP_SECONDARY_BLEND = 0.26

/** V0's secondary label blend toward the ground. */
const SECONDARY_BLEND = 0.3

/**
 * The ink or the ground, whichever reads better on a fill: the text colour
 * for buttons painted in the accent.
 * @param fill - the button fill.
 * @param ink - the scheme's ink.
 * @param ground - the scheme's ground.
 * @returns the colour to write on the fill.
 */
export function onFill(fill: Rgb, ink: Rgb, ground: Rgb): Rgb {
  return contrast(ink, fill) >= contrast(ground, fill) ? ink : ground
}

/**
 * The hover shade of a button fill: 15% toward white on a dark ground, toward
 * black on a light one.
 * @param fill - the button fill.
 * @param dark - whether the ground reads as dark.
 * @returns the hover colour.
 */
export function hoverOf(fill: Rgb, dark: boolean): Rgb {
  return blend(fill, dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }, 0.15)
}

/**
 * Derive every themed alias token from a palette. Surfaces follow V0's
 * `Theme` blends (chrome .045, surface .055, hover .095, elevated .08, border
 * .16, secondary ink .30). On a light ground layer 1 is white and layer 3
 * sits .01 below the ground: the step a chip needs is layer 3 against a white
 * card, and the ground's distance from white supplies it. A white ground has
 * no such distance, so there layer 3 takes the surface fraction (.055) and a
 * chip still reads on a card; the sidebar (.03) and the bubble (.05) sit 7
 * and 11 channel values below a white ground and keep their fractions. Ink
 * is deepened along its hue until it reads at 4.5:1 on the ground; the accent
 * is used verbatim as a fill (the primary buttons and the send button's info
 * pair) and deepened along its hue to 3:1 wherever it carries text or a
 * border (`brand-primary`, the business highlight); the three state colours
 * deepen from design-platform's seeds the same way. Nothing is desaturated.
 * A `crisp` palette adds {@link CRISP_BORDER_STEP} to each border alpha and
 * blends the secondary label {@link CRISP_SECONDARY_BLEND} toward the ground.
 * The result carries exactly {@link PRESET_TOKEN_KEYS}.
 * @param palette - ground, ink and accent as hex, plus the `flat` and `crisp` switches.
 * @returns the token dictionary.
 */
export function deriveTokens(palette: Palette): Tokens {
  const ground = requireHex(palette.ground)
  const dark = isDark(ground)
  const ink = deepenAlongHue(requireHex(palette.ink), ground, TEXT_CONTRAST)
  const fill = requireHex(palette.accent)
  const accent = deepenAlongHue(fill, ground, UI_CONTRAST)
  const surface = (t: number): Rgb => blend(ground, ink, t)
  const lift = (t: number): Rgb => blend(ground, { r: 255, g: 255, b: 255 }, t)
  const flat = palette.flat === true
  const crisp = palette.crisp === true
  const layer1 = flat ? ground : dark ? surface(0.045) : lift(1)
  const layer2 = flat ? ground : dark ? surface(0.08) : ground
  const lifted = toHex(layer1) !== toHex(ground)
  const layer3 = flat ? ground : dark ? surface(0.095) : lifted ? surface(0.01) : surface(0.055)
  const border = (alpha: number): string => toRgba(ink, crisp ? Math.round((alpha + CRISP_BORDER_STEP) * 100) / 100 : alpha)
  const hover = hoverOf(fill, dark)
  return {
    '--dsw-alias-bg-base': toHex(ground),
    '--dsw-alias-bg-layer-1': toHex(layer1),
    '--dsw-alias-bg-layer-2': toHex(layer2),
    '--dsw-alias-bg-layer-3': toHex(layer3),
    '--dsw-alias-bg-overlay': toHex(surface(dark ? 0.1 : 0.06)),
    '--dsw-specific-sidebar-fill': toHex(flat ? ground : surface(0.03)),
    '--dsw-specific-bubble': toHex(surface(dark ? 0.08 : 0.05)),
    '--dsw-specific-bubble-highlight': toHex(surface(dark ? 0.14 : 0.1)),
    '--dsw-specific-input-major': toHex(layer1),
    '--dsw-alias-label-primary': toHex(ink),
    '--dsw-alias-label-primary-bluish': toHex(ink),
    '--dsw-alias-label-primary-dimmed': toRgba(ink, 0.62),
    '--dsw-alias-label-secondary': toHex(blend(ink, ground, crisp ? CRISP_SECONDARY_BLEND : SECONDARY_BLEND)),
    '--dsw-alias-label-tertiary': toRgba(ink, 0.45),
    '--dsw-alias-label-caption': toRgba(ink, 0.55),
    '--dsw-alias-label-dimmed': toRgba(ink, 0.38),
    '--dsw-alias-border-l1': border(dark ? 0.06 : 0.05),
    '--dsw-alias-border-l2': border(dark ? 0.12 : 0.13),
    '--dsw-alias-border-l2-darkmode-thin': border(dark ? 0.08 : 0.13),
    '--dsw-alias-border-l3': border(0.16),
    '--dsw-alias-border-l4': border(0.2),
    '--dsw-alias-brand-primary': toHex(accent),
    '--dsw-alias-brand-primary-invert': toHex(onFill(fill, ink, ground)),
    '--dsw-alias-brand-text': toHex(ink),
    '--dsw-alias-button-primary-fill': toHex(fill),
    '--dsw-alias-button-primary-hover': toHex(hover),
    '--dsw-alias-button-primary-dimmed': toRgba(fill, 0.45),
    '--dsw-alias-button-info-fill': toHex(fill),
    '--dsw-alias-button-info-hover': toHex(hover),
    '--dsw-alias-interactive-bg-hover': toRgba(accent, dark ? 0.08 : 0.06),
    '--dsw-alias-interactive-bg-hover-accent': toRgba(accent, dark ? 0.14 : 0.12),
    '--dsw-alias-interactive-bg-active': toRgba(accent, dark ? 0.12 : 0.1),
    '--dsw-alias-state-business-primary': toHex(accent),
    '--dsw-alias-state-business-tertiary': toHex(blend(ground, accent, dark ? 0.18 : 0.14)),
    '--dsw-alias-state-error-primary': toHex(deepenAlongHue(requireHex(dark ? STATE_SEEDS.error.dark : STATE_SEEDS.error.light), ground, TEXT_CONTRAST)),
    '--dsw-alias-state-warn-label': toHex(deepenAlongHue(requireHex(STATE_SEEDS.warn), ground, TEXT_CONTRAST)),
    '--dsw-alias-state-success-primary': toHex(deepenAlongHue(requireHex(STATE_SEEDS.success), ground, UI_CONTRAST)),
    '--dsw-alias-bg-multi-select': toHex(blend(ground, accent, dark ? 0.18 : 0.22)),
    '--dsw-alias-markdown-inline-code': toRgba(ink, dark ? 0.08 : 0.06),
    '--dsw-alias-markdown-code-block': toHex(flat ? surface(0.03) : dark ? ground : surface(0.0)),
    '--dsw-alias-markdown-code-block-banner': toHex(dark ? surface(0.08) : surface(0.03)),
  }
}

/**
 * A token dictionary as CSS declarations, one per line, for a stylesheet
 * block.
 * @param tokens - token name → value.
 * @returns the declaration lines, each indented two spaces and ending in `;`.
 */
export function tokenDeclarations(tokens: Tokens): string {
  return Object.entries(tokens).map(([name, value]) => `  ${name}: ${value};`).join('\n')
}

/** The resolved appearance for one scheme, ready for ui-theme's override layer. */
export interface ResolvedScheme {
  /** Alias tokens; the IDEalize preset's equal the skin's own sheet. */
  tokens: Tokens
  /** The palette the tokens derive from (swatches and the readability readout). */
  palette: Palette
}

/** What the panel resolved for both schemes plus the mode the choice demands. */
export interface Resolved {
  light: ResolvedScheme
  dark: ResolvedScheme
  /**
   * The colour scheme the selection forces, or undefined when the user's
   * light/dark/system mode stands. A custom ground forces its own scheme.
   */
  forcedScheme: 'light' | 'dark' | undefined
}

/**
 * The layer-1 surface colour of a resolved scheme (the far end of a seeded
 * background gradient).
 * @param side - one resolved scheme.
 * @returns the `--dsw-alias-bg-layer-1` hex.
 */
export function surfaceHex(side: ResolvedScheme): string {
  const hex = side.tokens['--dsw-alias-bg-layer-1']
  if (hex === undefined) throw new Error('deriveTokens always emits --dsw-alias-bg-layer-1')
  return hex
}

/**
 * Resolve preset plus custom colours into per-scheme tokens. A custom ground
 * replaces both schemes' grounds and forces the scheme its luminance reads
 * as; a custom accent replaces both schemes' accents.
 * @param id - selected preset.
 * @param groundHex - the user's ground, or empty.
 * @param accentHex - the user's accent, or empty.
 * @returns both schemes and the forced scheme, if any.
 */
export function resolveAppearance(id: PresetId, groundHex: string, accentHex: string): Resolved {
  const ground = parseHex(groundHex)
  const accent = parseHex(accentHex)
  const entry = preset(id)
  const scheme = (which: 'light' | 'dark'): ResolvedScheme => {
    const base = presetPalette(id, which)
    const palette: Palette = {
      ground: ground === undefined ? base.ground : toHex(ground),
      ink: base.ink,
      accent: accent === undefined ? base.accent : toHex(accent),
      ...(base.flat === true ? { flat: true } : {}),
      ...(base.crisp === true ? { crisp: true } : {}),
    }
    return { tokens: deriveTokens(palette), palette }
  }
  // A custom ground keeps the preset's ink for the scheme it reads as, on
  // both sides, so switching mode never pairs a dark ink with a dark ground.
  if (ground !== undefined) {
    const forcedScheme = isDark(ground) ? 'dark' : 'light'
    const side = scheme(forcedScheme)
    return { light: side, dark: side, forcedScheme }
  }
  const forcedScheme = entry.scheme === 'system' ? undefined : entry.scheme
  return { light: scheme('light'), dark: scheme('dark'), forcedScheme }
}
