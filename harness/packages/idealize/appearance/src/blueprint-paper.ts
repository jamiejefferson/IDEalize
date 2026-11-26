/**
 * The blueprint terminal themes' paper: a lit and shaded ground, fine grain,
 * an optional crease, a drafting grid, and ink that glows a little into the
 * sheet. JJ settled the three themes' values on a tuning page on 24 Nov 2026
 * (`_AppDev/IDEalize/blueprint-tuner`); {@link paperPaint} reproduces that
 * page's CSS so the grid matches what was tuned. A theme carries a full
 * {@link ThemePaper}; the user's own adjustments are a sparse
 * {@link PaperTweaks} layered over it, kept per theme.
 */

import { blend, parseHex, toHex, type Rgb } from './colour.ts'

/** The paper dials a blueprint theme sets and the user may adjust. Percentages are 0–100. */
export interface PaperSettings {
  /** Where the light falls, across the sheet: 0 is the left edge, 100 the right. */
  lightX: number
  /** Where the light falls, down the sheet: 0 is the top edge, 100 the bottom. */
  lightY: number
  /** How much lighter the lit point is than the ground, in percent. */
  light: number
  /** How much darker the far corner is than the ground, in percent. */
  shade: number
  /** Fine fibre grain strength, in percent. */
  grain: number
  /** Grain tile size in px; smaller is finer. */
  grainScale: number
  /** One faint diagonal fold. */
  crease: boolean
  /** Whether the drafting grid is drawn. */
  grid: boolean
  /** Distance between the grid's fine lines in px. */
  gridMinor: number
  /** Fine line opacity in percent, capped at 20 so the grid stays behind the text. */
  gridMinorOpacity: number
  /** A heavier line every this many fine lines. */
  gridMajorEvery: number
  /** Heavy line opacity in percent, capped at 20. */
  gridMajorOpacity: number
  /** Blur on the grid lines in px. */
  gridSoften: number
  /** Text opacity in percent; below 100 the paper shows through the ink. */
  inkOpacity: number
  /** Glow in each letter's own colour, in percent. Zero switches it off. */
  halo: number
  /** How far the glow reaches in px. */
  haloSpread: number
  /** Dark offset under the text, in percent. Separate from the halo; zero switches it off. */
  shadow: number
  /** Distance the shadow drops in px. */
  shadowOffset: number
  /** Softness of the shadow in px. */
  shadowBlur: number
  /**
   * How much of a program's own block colour shows, in percent; the paper
   * takes the rest. Programs such as Claude Code paint panels and buttons in
   * exact colours no theme can rename, so on a blueprint they sink into the sheet.
   */
  blocks: number
}

/**
 * A theme's paper: every dial, plus the colours the tuning page set that the
 * theme's own fields do not name. The ground, ink and accent are the theme's
 * `background`, `foreground` and `cursor`.
 */
export interface ThemePaper extends PaperSettings {
  /** Grid line colour `#RRGGBB`. */
  gridColour: string
  /** Secondary ink `#RRGGBB`: prompts, paths and dim text. The theme's ANSI slots holding it follow an adjustment. */
  secondary: string
  /** Warning ink `#RRGGBB`: errors. The theme's ANSI slots holding it follow an adjustment. */
  warning: string
  /** The colour `#RRGGBB` laid over a program's own blocks, at the strength {@link PaperSettings.blocks} leaves it. */
  blockColour: string
}

/** The colours of a blueprint theme the user may change, each `#RRGGBB`. */
export interface PaperColours {
  /** Paper colour (the theme's `background`). */
  ground: string
  /** Ink (the theme's `foreground`). */
  ink: string
  /** Secondary ink. */
  secondary: string
  /** Accent: the cursor and the prompt mark (the theme's `cursor`). */
  accent: string
  /** Warning ink. */
  warning: string
  /** Grid line colour. */
  gridColour: string
  /** The chat's header strip above the terminal; the theme's own is its paper colour. */
  header: string
  /** The colour laid over a program's own blocks. */
  blockColour: string
}

/** The colour dials in the order the panel lists them. */
export const PAPER_COLOURS: readonly (keyof PaperColours)[] = Object.freeze(['ground', 'header', 'blockColour', 'ink', 'secondary', 'accent', 'warning', 'gridColour'])

/** The user's adjustments to one theme: only the dials and colours they changed. */
export type PaperTweaks = Partial<PaperSettings & PaperColours>

/** The paper dials that are numbers (every one but the two switches). */
export type PaperNumberKey = { [K in keyof PaperSettings]: PaperSettings[K] extends number ? K : never }[keyof PaperSettings]

/** The paper dials that are switches. */
export type PaperSwitchKey = Exclude<keyof PaperSettings, PaperNumberKey>

/** One number dial's bounds and slider step. */
export interface PaperRange {
  min: number
  max: number
  step: number
}

/**
 * Bounds for every number dial, shared by the settings schema and the panel's
 * sliders. Ink opacity stops at 40 so text cannot be tuned out of sight.
 */
export const PAPER_RANGES: Readonly<Record<PaperNumberKey, PaperRange>> = Object.freeze({
  lightX: { min: 0, max: 100, step: 1 },
  lightY: { min: 0, max: 100, step: 1 },
  light: { min: 0, max: 100, step: 1 },
  shade: { min: 0, max: 100, step: 1 },
  grain: { min: 0, max: 100, step: 1 },
  grainScale: { min: 100, max: 600, step: 10 },
  gridMinor: { min: 4, max: 32, step: 1 },
  gridMinorOpacity: { min: 0, max: 20, step: 0.5 },
  gridMajorEvery: { min: 2, max: 10, step: 1 },
  gridMajorOpacity: { min: 0, max: 20, step: 0.5 },
  gridSoften: { min: 0, max: 2, step: 0.05 },
  inkOpacity: { min: 40, max: 100, step: 1 },
  halo: { min: 0, max: 100, step: 1 },
  haloSpread: { min: 0, max: 6, step: 0.25 },
  shadow: { min: 0, max: 100, step: 1 },
  shadowOffset: { min: 0, max: 4, step: 0.25 },
  shadowBlur: { min: 0, max: 4, step: 0.25 },
  blocks: { min: 0, max: 100, step: 1 },
})

/** The two switch dials. */
export const PAPER_SWITCHES: readonly PaperSwitchKey[] = Object.freeze(['crease', 'grid'])

/**
 * A stored colour when it parses, else the theme's own.
 * @param stored - the adjustment, if any.
 * @param own - the theme's colour.
 * @returns a canonical `#RRGGBB`.
 */
export function paperColour(stored: string | undefined, own: string): string {
  const parsed = stored === undefined ? undefined : parseHex(stored)
  return parsed === undefined ? own : toHex(parsed)
}

/**
 * One theme's paper with the user's adjustments over it. The ground, header, ink and
 * accent adjustments belong to the theme's own fields and are applied by
 * `resolveTerminalPaint`, so they are left out here.
 * @param paper - the theme's own paper.
 * @param tweaks - the user's adjustments for that theme, if any.
 * @returns the paper to draw.
 */
export function tweakedPaper(paper: ThemePaper, tweaks: PaperTweaks | undefined): ThemePaper {
  const { ground: _ground, header: _header, ink: _ink, accent: _accent, ...dials } = tweaks ?? {}
  return {
    ...paper,
    ...dials,
    gridColour: paperColour(dials.gridColour, paper.gridColour),
    secondary: paperColour(dials.secondary, paper.secondary),
    warning: paperColour(dials.warning, paper.warning),
    blockColour: paperColour(dials.blockColour, paper.blockColour),
  }
}

/**
 * Record one adjusted dial or colour for one theme. A value equal to the
 * theme's own, or an empty colour, removes the adjustment, and a theme left
 * with none drops out, so untouched settings stay equal to the defaults.
 * @param all - every theme's adjustments, keyed by theme id.
 * @param themeId - the theme being adjusted.
 * @param key - the dial or colour.
 * @param value - its new value.
 * @param own - the theme's own value for it.
 * @returns the next adjustments record.
 */
export function withPaperTweak<K extends keyof PaperTweaks>(
  all: Readonly<Record<string, PaperTweaks>>, themeId: string, key: K, value: NonNullable<PaperTweaks[K]>, own: NonNullable<PaperTweaks[K]>,
): Record<string, PaperTweaks> {
  const next: PaperTweaks = { ...all[themeId] }
  if (value === own || value === '') Reflect.deleteProperty(next, key)
  else next[key] = value
  const rest = Object.fromEntries(Object.entries(all).filter(([id]) => id !== themeId))
  return Object.keys(next).length === 0 ? rest : { ...rest, [themeId]: next }
}

/** The paper as CSS the terminal view can place without knowing the dials. */
export interface TerminalPaperPaint {
  /** `background-image` for the lit and shaded ground. */
  ground: string
  /** Grain layer, absent at zero strength. */
  grain?: { opacity: number; size: number }
  /** Whether the fold is drawn. */
  crease: boolean
  /** Grid layer, absent when the grid is off. */
  grid?: { image: string; size: string; blur: number }
  /** Opacity of the text rows, 0–1. */
  inkOpacity: number
  /** `text-shadow` for every run of text: the halo, the shadow, both, or `none`. */
  textShadow: string
  /**
   * `background-image` laid over a block a program painted in an exact colour:
   * a flat wash of the paper's block colour, so only part of the program's
   * colour shows. Absent when blocks show in full.
   */
  blockCover?: string
  /**
   * `background` for the chat's header strip above the terminal: its colour
   * under the same grid, measured up from the strip's bottom edge so the lines
   * run on into the terminal's.
   */
  header: string
}

/** Two decimals at most, without trailing zeros, for values written into CSS. */
function trim(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * The lightest and darkest the ground gets, for the selection rule to clear.
 * Mixed in sRGB; the drawn gradient mixes in Oklab, which lands within the
 * selection rule's margin of these.
 * @param paper - the paper being drawn.
 * @param background - the flat ground.
 * @returns the lit and shaded extremes.
 */
export function paperGrounds(paper: PaperSettings, background: Rgb): Rgb[] {
  return [
    blend(background, { r: 255, g: 255, b: 255 }, paper.light / 100),
    blend(background, { r: 0, g: 0, b: 0 }, paper.shade / 100),
  ]
}

/**
 * Turn a paper into the CSS the terminal view draws. The expressions match
 * the tuning page's. Text opacity is applied to the whole row, so the halo
 * and shadow strengths are divided by it here to land at the strength tuned.
 * @param paper - the paper to draw (theme values with any adjustments).
 * @param background - the flat ground.
 * @param header - the header strip's colour `#RRGGBB`; the ground when omitted.
 * @returns the CSS-ready paint.
 */
export function paperPaint(paper: ThemePaper, background: Rgb, header: string = toHex(background)): TerminalPaperPaint {
  const base = toHex(background)
  const ground = `radial-gradient(farthest-corner at ${trim(paper.lightX)}% ${trim(paper.lightY)}% in oklab, `
    + `color-mix(in oklab, #fff ${trim(paper.light)}%, ${base}) 0%, ${base} 45%, `
    + `color-mix(in oklab, #000 ${trim(paper.shade)}%, ${base}) 100%)`

  const line = (opacity: number, direction: 'right' | 'bottom'): string =>
    `linear-gradient(to ${direction}, color-mix(in srgb, ${paper.gridColour} ${trim(opacity)}%, transparent) 0 1px, transparent 1px)`
  const major = `${trim(paper.gridMinor * paper.gridMajorEvery)}px`
  const minor = `${trim(paper.gridMinor)}px`
  const lines = [
    line(paper.gridMajorOpacity, 'right'), line(paper.gridMajorOpacity, 'bottom'),
    line(paper.gridMinorOpacity, 'right'), line(paper.gridMinorOpacity, 'bottom'),
  ]
  const grid = paper.grid
    ? { image: lines.join(', '), size: `${major} ${major}, ${major} ${major}, ${minor} ${minor}, ${minor} ${minor}`, blur: paper.gridSoften }
    : undefined
  const strip = paper.grid
    ? [...lines.map((image, index) => `${image} 0 100% / ${index < 2 ? `${major} ${major}` : `${minor} ${minor}`}`), header].join(', ')
    : header

  const inkOpacity = paper.inkOpacity / 100
  const onRow = (percent: number): number => Math.min(100, percent / inkOpacity)
  const shadows: string[] = []
  if (paper.halo > 0) shadows.push(`0 0 ${trim(paper.haloSpread)}px color-mix(in srgb, currentColor ${trim(onRow(paper.halo))}%, transparent)`)
  if (paper.shadow > 0) shadows.push(`0 ${trim(paper.shadowOffset)}px ${trim(paper.shadowBlur)}px rgb(0 0 0 / ${trim(onRow(paper.shadow))}%)`)

  const wash = `color-mix(in srgb, ${paper.blockColour} ${trim(100 - paper.blocks)}%, transparent)`

  return {
    ground,
    ...(paper.grain > 0 ? { grain: { opacity: paper.grain / 100, size: paper.grainScale } } : {}),
    crease: paper.crease,
    ...(grid === undefined ? {} : { grid }),
    inkOpacity,
    textShadow: shadows.length === 0 ? 'none' : shadows.join(', '),
    ...(paper.blocks < 100 ? { blockCover: `linear-gradient(${wash}, ${wash})` } : {}),
    header: strip,
  }
}
