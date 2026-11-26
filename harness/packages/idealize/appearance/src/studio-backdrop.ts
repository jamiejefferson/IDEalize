/**
 * The Studio's backdrop: the view drawn as a photo studio's wall and floor,
 * with one lamp, a clouded canvas texture and fine grain, and the Studio's
 * text and panels coloured to sit on it. JJ settled the three backdrops'
 * values on a tuning page on 26 Nov 2026 (`_AppDev/IDEalize/studio-tuner`);
 * {@link backdropPaint} reproduces that page's CSS so the view matches what
 * was tuned. A backdrop carries a full {@link Backdrop}; the user's own
 * adjustments are a sparse {@link BackdropTweaks} layered over it, kept per
 * backdrop.
 */

import { blend, contrast, deepenAgainstAll, parseHex, requireHex, toHex } from './colour.ts'
import type { Rgb } from './colour.ts'

/** The backdrop dials a preset sets and the user may adjust. Percentages are 0–100. */
export interface BackdropSettings {
  /** How far the corners darken away from the lamp, in percent. */
  vignette: number
  /** The lamp's level, in percent. Zero leaves the wall unlit. */
  light: number
  /** Where the lamp points, across the view: 0 is the left edge, 100 the right. */
  lightX: number
  /** Where the lamp points, down the view: 0 is the top edge, 100 the bottom. */
  lightY: number
  /** Width of the lit pool, as a percentage of the view's width. */
  lightW: number
  /** Height of the lit pool, as a percentage of the view's height. */
  lightH: number
  /** Strength of the clouded, hand-painted canvas pattern, in percent. */
  mottle: number
  /** Size of the clouds in px; smaller reads as dappled cloth. */
  mottleScale: number
  /** Fine fibre grain strength, in percent. */
  grain: number
  /** Grain tile size in px; smaller is finer. */
  grainScale: number
  /** Whether a floor is drawn; off leaves one continuous wall. */
  floor: boolean
  /** Where the wall meets the floor, in percent from the top. */
  horizon: number
  /** How much of the lamp spills onto the floor, in percent. */
  floorLight: number
  /** Distance in px the floor fades in over; high values curve the wall into the floor. */
  seamSoft: number
  /** The dark band where the wall drops behind the floor, in percent. */
  seamShade: number
  /** Brushed streaks on the floor, in percent. */
  floorTexture: number
  /** Text size in px. */
  size: number
  /** Text weight, 400–600. */
  weight: number
  /** Line height as a multiple of the text size. */
  leading: number
  /** Space between letters in em. */
  tracking: number
  /** Text opacity in percent; below 100 the backdrop shows through the text. */
  inkOpacity: number
  /** How solid the panels are, in percent. Zero leaves them as outlines. */
  panelFill: number
  /** Blur of the backdrop behind a panel in px. */
  panelBlur: number
  /** Strength of the panels' hairline, drawn in the text colour, in percent. */
  panelEdge: number
}

/** The colours of a backdrop, each `#RRGGBB`. */
export interface BackdropColours {
  /** The unlit wall. */
  wall: string
  /** The colour the lamp throws. */
  lightColour: string
  /** The floor before the lamp reaches it. */
  floorColour: string
  /** Titles, names and messages. */
  ink: string
  /** Times, hints and message detail. */
  secondary: string
  /** Agent names and links. */
  accent: string
  /** The summary card and the message box. */
  panel: string
}

/** A whole backdrop: every dial and colour. */
export type Backdrop = BackdropSettings & BackdropColours

/** The user's adjustments to one backdrop: only the dials and colours they changed. */
export type BackdropTweaks = Partial<Backdrop>

/** The backdrops JJ tuned, in the order the panel lists them. */
export const STUDIO_BACKDROP_IDS = ['grey', 'blue', 'white'] as const

/** One of {@link STUDIO_BACKDROP_IDS}. */
export type StudioBackdropId = typeof STUDIO_BACKDROP_IDS[number]

/** A backdrop the panel offers. */
export interface StudioBackdrop {
  id: StudioBackdropId
  /** The name shown in the panel. */
  name: string
  backdrop: Backdrop
}

/**
 * JJ's settled values (26 Nov 2026): a lit charcoal wall, a clouded teal canvas, a white cove. The walls,
 * light, texture and floor are from the tuning page; the text and panels were retuned in the app the same day.
 */
export const STUDIO_BACKDROPS: readonly StudioBackdrop[] = Object.freeze([
  {
    id: 'grey',
    name: 'Grey',
    backdrop: {
      wall: '#242424', vignette: 52, lightColour: '#F2F2F2', light: 21, lightX: 50, lightY: 9, lightW: 64, lightH: 48,
      mottle: 34, mottleScale: 1080, grain: 10, grainScale: 300,
      floor: true, horizon: 80, floorColour: '#000000', floorLight: 31, seamSoft: 36, seamShade: 16, floorTexture: 16,
      size: 11, weight: 450, leading: 1.5, tracking: 0, ink: '#FFFFFF', inkOpacity: 100, secondary: '#C7C7C7', accent: '#0B4FA8',
      panel: '#FFFFFF', panelFill: 61, panelBlur: 6, panelEdge: 38,
    },
  },
  {
    id: 'blue',
    name: 'Blue',
    backdrop: {
      wall: '#024364', vignette: 88, lightColour: '#429A84', light: 44, lightX: 63, lightY: 34, lightW: 78, lightH: 90,
      mottle: 51, mottleScale: 820, grain: 26, grainScale: 240,
      floor: true, horizon: 79, floorColour: '#2A6E8C', floorLight: 18, seamSoft: 116, seamShade: 48, floorTexture: 18,
      size: 11, weight: 400, leading: 1.5, tracking: 0, ink: '#F4FAFC', inkOpacity: 100, secondary: '#C4C4C4', accent: '#FFFFFF',
      panel: '#FFFFFF', panelFill: 57, panelBlur: 0, panelEdge: 47,
    },
  },
  {
    id: 'white',
    name: 'White',
    backdrop: {
      wall: '#D9D9D9', vignette: 39, lightColour: '#FFFFFF', light: 100, lightX: 60, lightY: 17, lightW: 76, lightH: 62,
      mottle: 18, mottleScale: 1500, grain: 4, grainScale: 300,
      floor: true, horizon: 79, floorColour: '#E6E6E6', floorLight: 72, seamSoft: 72, seamShade: 6, floorTexture: 38,
      size: 11, weight: 400, leading: 1.5, tracking: 0, ink: '#292929', inkOpacity: 100, secondary: '#696969', accent: '#B04594',
      panel: '#FFFFFF', panelFill: 29, panelBlur: 16, panelEdge: 32,
    },
  },
])

/**
 * Look a backdrop up by id.
 * @param id - the backdrop's id.
 * @returns the backdrop; an id that is not listed reads as the first.
 */
export function studioBackdrop(id: string): StudioBackdrop {
  const found = STUDIO_BACKDROPS.find(option => option.id === id) ?? STUDIO_BACKDROPS[0]
  /* v8 ignore next -- the list is a non-empty literal. */
  if (found === undefined) throw new Error('studio-backdrop: no backdrops')
  return found
}

/** The colour dials in the order the panel lists them. */
export const BACKDROP_COLOURS: readonly (keyof BackdropColours)[] = Object.freeze([
  'wall', 'lightColour', 'floorColour', 'ink', 'secondary', 'accent', 'panel',
])

/** The backdrop dials that are numbers (every one but the floor switch). */
export type BackdropNumberKey = { [K in keyof BackdropSettings]: BackdropSettings[K] extends number ? K : never }[keyof BackdropSettings]

/** One number dial's bounds and slider step. */
export interface BackdropRange {
  min: number
  max: number
  step: number
}

/**
 * Bounds for every number dial, shared by the settings schema and the panel's
 * sliders; they are the tuning page's. Text opacity stops at 40 so text
 * cannot be tuned out of sight.
 */
export const BACKDROP_RANGES: Readonly<Record<BackdropNumberKey, BackdropRange>> = Object.freeze({
  vignette: { min: 0, max: 100, step: 1 },
  light: { min: 0, max: 100, step: 1 },
  lightX: { min: 0, max: 100, step: 1 },
  lightY: { min: 0, max: 100, step: 1 },
  lightW: { min: 10, max: 150, step: 1 },
  lightH: { min: 10, max: 150, step: 1 },
  mottle: { min: 0, max: 100, step: 1 },
  mottleScale: { min: 300, max: 2400, step: 20 },
  grain: { min: 0, max: 100, step: 1 },
  grainScale: { min: 100, max: 600, step: 10 },
  horizon: { min: 50, max: 96, step: 1 },
  floorLight: { min: 0, max: 100, step: 1 },
  seamSoft: { min: 0, max: 200, step: 2 },
  seamShade: { min: 0, max: 100, step: 1 },
  floorTexture: { min: 0, max: 100, step: 1 },
  size: { min: 11, max: 17, step: 0.5 },
  weight: { min: 400, max: 600, step: 50 },
  leading: { min: 1.2, max: 1.9, step: 0.05 },
  tracking: { min: -0.03, max: 0.05, step: 0.005 },
  inkOpacity: { min: 40, max: 100, step: 1 },
  panelFill: { min: 0, max: 100, step: 1 },
  panelBlur: { min: 0, max: 30, step: 1 },
  panelEdge: { min: 0, max: 60, step: 1 },
})

/**
 * A stored colour when it parses, else the backdrop's own.
 * @param stored - the adjustment, if any.
 * @param own - the backdrop's colour.
 * @returns a canonical `#RRGGBB`.
 */
function colourOr(stored: string | undefined, own: string): string {
  const parsed = stored === undefined ? undefined : parseHex(stored)
  return parsed === undefined ? own : toHex(parsed)
}

/**
 * One backdrop with the user's adjustments over it.
 * @param backdrop - the preset's own values.
 * @param tweaks - the user's adjustments for that backdrop, if any.
 * @returns the backdrop to draw.
 */
export function tweakedBackdrop(backdrop: Backdrop, tweaks: BackdropTweaks | undefined): Backdrop {
  const next: Backdrop = { ...backdrop, ...tweaks }
  for (const key of BACKDROP_COLOURS) next[key] = colourOr(tweaks?.[key], backdrop[key])
  return next
}

/**
 * Record one adjusted dial or colour for one backdrop. A value equal to the
 * backdrop's own, or an empty colour, removes the adjustment, and a backdrop
 * left with none drops out, so untouched settings stay equal to the defaults.
 * @param all - every backdrop's adjustments, keyed by backdrop id.
 * @param id - the backdrop being adjusted.
 * @param key - the dial or colour.
 * @param value - its new value.
 * @param own - the backdrop's own value for it.
 * @returns the next adjustments record.
 */
export function withBackdropTweak<K extends keyof BackdropTweaks>(
  all: Readonly<Record<string, BackdropTweaks>>,
  id: string,
  key: K,
  value: NonNullable<BackdropTweaks[K]>,
  own: NonNullable<BackdropTweaks[K]>,
): Record<string, BackdropTweaks> {
  const next: BackdropTweaks = { ...all[id] }
  if (value === own || value === '') Reflect.deleteProperty(next, key)
  else next[key] = value
  const rest = Object.fromEntries(Object.entries(all).filter(([other]) => other !== id))
  return Object.keys(next).length === 0 ? rest : { ...rest, [id]: next }
}

/** The backdrop as CSS the Studio view can place without knowing the dials. */
export interface StudioBackdropPaint {
  /** `background-color` of the unlit wall. */
  wall: string
  /** `background-image` of the lamp's pool. */
  light: string
  /** `background-image` darkening the corners. */
  vignette: string
  /** The floor and the shade above it, absent when the floor is off. */
  floor?: {
    /** `background-image` of the band where the wall drops behind the floor. */
    seam: string
    /** `top` of the floor, a percentage of the view. */
    top: string
    /** `background-color` of the floor. */
    colour: string
    /** `background-image` of the lamp's spill on the floor. */
    image: string
    /** `mask-image` fading the floor in from the seam. */
    mask: string
    /** Opacity of the brushed streaks, 0–1; absent at zero. */
    streaks?: number
  }
  /** Clouded canvas layer, absent at zero strength. */
  mottle?: { opacity: number; size: number }
  /** Grain layer, absent at zero strength. */
  grain?: { opacity: number; size: number }
  /** Custom properties for the view's root: the text and panel values. */
  variables: Record<string, string>
}

/** Three decimals at most, without trailing zeros, for values written into CSS. */
function trim(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** A colour at a strength in percent, as the tuning page mixed it. */
function mix(colour: string, percent: number): string {
  return percent >= 100 ? colour : `color-mix(in srgb, ${colour} ${trim(percent)}%, transparent)`
}

/** The text colours a backdrop is drawn with, each checked against the ground it sits on. */
export interface BackdropInks {
  /** The chat's title, on the wall at the head of the view. */
  title: string
  /** The line under the message box, on the floor at the foot of the view. */
  foot: string
  /** Text straight on the backdrop anywhere in the view, and its secondary. */
  open: string
  open2: string
  /** Text on a panel (a message row, a tile, the message box), its secondary and its accent. */
  panel: string
  panel2: string
  panelAccent: string
  /** The failure colour on a panel: the app's red, moved along its hue until it reads there. */
  panelError: string
  /** The fill of a control that stands proud of a panel (a chosen segment, a button), which panel text reads on. */
  raised: string
}

/** The app's failure red (`--dsw-alias-state-error-primary` on the light theme). */
const FAILURE_RED = '#EC1313'

/** The contrast every backdrop text colour is held to against its ground. */
export const BACKDROP_TEXT_CONTRAST = 4.5
/** Panel text is held a little higher, because controls lay a faint wash of the text colour under it. */
export const BACKDROP_PANEL_CONTRAST = 5

/**
 * Work out the colours a backdrop's text is drawn in. JJ's colours stand
 * wherever they read; where one does not clear the contrast floor against
 * the ground it sits on, its lightness moves along its own hue until it does
 * (the deepen-along-hue rule). The grounds are the wall and the floor, unlit,
 * under the lamp and in the corner falloff; a panel's grounds are its colour
 * laid over each of those at its fill.
 *
 * Until 26 Nov 2026 the view drew JJ's text colour everywhere. On Grey and
 * Blue that put near-white text on a panel that is more than half white, and
 * on controls with a white fill of their own (JJ: "this is still unusable").
 * @param backdrop - the backdrop (preset values with any adjustments).
 * @returns the text colours as hex.
 */
export function backdropInks(backdrop: Backdrop): BackdropInks {
  const black = { r: 0, g: 0, b: 0 }
  const white = { r: 255, g: 255, b: 255 }
  const lamp = requireHex(backdrop.lightColour)
  // Text never sits in the far corner itself, so the falloff counts at 70%.
  const falloff = backdrop.vignette / 100 * 0.7
  const wall = requireHex(backdrop.wall)
  const walls = [wall, blend(wall, lamp, backdrop.light / 100), blend(wall, black, falloff)]
  const base = requireHex(backdrop.floorColour)
  const floors = backdrop.floor ? [base, blend(base, lamp, backdrop.floorLight / 100), blend(base, black, falloff)] : walls
  const everywhere = [...walls, ...floors]
  const fill = requireHex(backdrop.panel)
  const panels = everywhere.map(ground => blend(ground, fill, backdrop.panelFill / 100))
  const read = (colour: string, grounds: readonly Rgb[], target: number): Rgb => deepenAgainstAll(requireHex(colour), grounds, target)
  const worst = (colour: Rgb, grounds: readonly Rgb[]): number => Math.min(...grounds.map(ground => contrast(colour, ground)))

  const panel = read(backdrop.ink, panels, BACKDROP_PANEL_CONTRAST)
  const panel2 = read(backdrop.secondary, panels, BACKDROP_PANEL_CONTRAST)
  // A raised control is white or near-black, whichever the panel's text reads on better.
  const dark = { r: 20, g: 20, b: 20 }
  const raised = worst(white, [panel, panel2]) >= worst(dark, [panel, panel2]) ? white : dark
  return {
    title: toHex(read(backdrop.ink, walls, BACKDROP_TEXT_CONTRAST)),
    foot: toHex(read(backdrop.secondary, floors, BACKDROP_TEXT_CONTRAST)),
    open: toHex(read(backdrop.ink, everywhere, BACKDROP_TEXT_CONTRAST)),
    open2: toHex(read(backdrop.secondary, everywhere, BACKDROP_TEXT_CONTRAST)),
    panel: toHex(panel),
    panel2: toHex(panel2),
    panelAccent: toHex(read(backdrop.accent, panels, BACKDROP_PANEL_CONTRAST)),
    panelError: toHex(read(FAILURE_RED, panels, BACKDROP_PANEL_CONTRAST)),
    raised: toHex(raised),
  }
}

/**
 * Turn a backdrop into the CSS the Studio view draws. The expressions match
 * the tuning page's.
 * @param backdrop - the backdrop to draw (preset values with any adjustments).
 * @param fontFamily - the CSS `font-family` for the Studio's text; omitted keeps the interface font.
 * @returns the CSS-ready paint.
 */
export function backdropPaint(backdrop: Backdrop, fontFamily?: string): StudioBackdropPaint {
  const at = `${trim(backdrop.lightX)}% ${trim(backdrop.lightY)}%`
  // Five stops approximate a lamp's falloff, each a share of the light level.
  const lamp = (share: number): string => mix(backdrop.lightColour, backdrop.light * share)
  const light = `radial-gradient(ellipse ${trim(backdrop.lightW)}% ${trim(backdrop.lightH)}% at ${at}, `
    + `${lamp(1)} 0%, ${lamp(0.8)} 24%, ${lamp(0.46)} 50%, ${lamp(0.16)} 76%, transparent 100%)`
  const vignette = `radial-gradient(farthest-corner at ${at}, transparent 35%, ${mix('#000', backdrop.vignette)} 100%)`

  const horizon = `${trim(backdrop.horizon)}%`
  const shade = mix('#000', backdrop.seamShade)
  const floor = backdrop.floor
    ? {
      // The shade carries on under the floor, so a soft seam has no hard line.
      seam: `linear-gradient(to bottom, transparent calc(${horizon} - 30%), ${shade} ${horizon}, ${shade} 100%)`,
      top: horizon,
      colour: backdrop.floorColour,
      image: `radial-gradient(ellipse 75% 130% at ${trim(backdrop.lightX)}% 0%, ${mix(backdrop.lightColour, backdrop.floorLight)} 0%, `
        + `${mix(backdrop.lightColour, backdrop.floorLight * 0.4)} 55%, transparent 100%)`,
      mask: `linear-gradient(to bottom, transparent 0, #000 ${trim(backdrop.seamSoft)}px)`,
      ...(backdrop.floorTexture > 0 ? { streaks: backdrop.floorTexture / 100 } : {}),
    }
    : undefined

  const inks = backdropInks(backdrop)
  const variables: Record<string, string> = {
    '--idealize-backdrop-title-ink': mix(inks.title, backdrop.inkOpacity),
    '--idealize-backdrop-foot-ink': mix(inks.foot, backdrop.inkOpacity),
    '--idealize-backdrop-open-ink': mix(inks.open, backdrop.inkOpacity),
    '--idealize-backdrop-open-ink-2': mix(inks.open2, backdrop.inkOpacity),
    '--idealize-backdrop-panel-ink': mix(inks.panel, backdrop.inkOpacity),
    '--idealize-backdrop-panel-ink-2': mix(inks.panel2, backdrop.inkOpacity),
    '--idealize-backdrop-panel-accent': mix(inks.panelAccent, backdrop.inkOpacity),
    '--idealize-backdrop-panel-error': inks.panelError,
    '--idealize-backdrop-panel-raised': inks.raised,
    '--idealize-backdrop-panel-wash': mix(inks.panel, 8),
    '--idealize-backdrop-panel-wash-2': mix(inks.panel, 14),
    '--idealize-backdrop-panel-line': mix(inks.panel, 24),
    '--idealize-backdrop-ink': mix(backdrop.ink, backdrop.inkOpacity),
    '--idealize-backdrop-ink-2': mix(backdrop.secondary, backdrop.inkOpacity),
    '--idealize-backdrop-accent': mix(backdrop.accent, backdrop.inkOpacity),
    '--idealize-backdrop-size': `${trim(backdrop.size)}px`,
    '--idealize-backdrop-weight': trim(backdrop.weight),
    '--idealize-backdrop-leading': trim(backdrop.leading),
    '--idealize-backdrop-tracking': `${trim(backdrop.tracking)}em`,
    '--idealize-backdrop-panel': mix(backdrop.panel, backdrop.panelFill),
    '--idealize-backdrop-panel-blur': `${trim(backdrop.panelBlur)}px`,
    '--idealize-backdrop-panel-edge': mix(backdrop.ink, backdrop.panelEdge),
    '--idealize-backdrop-wash': mix(backdrop.ink, 10),
    ...(fontFamily === undefined ? {} : { '--idealize-backdrop-font': fontFamily }),
  }

  return {
    wall: backdrop.wall,
    light,
    vignette,
    ...(floor === undefined ? {} : { floor }),
    ...(backdrop.mottle > 0 ? { mottle: { opacity: backdrop.mottle / 100, size: backdrop.mottleScale } } : {}),
    ...(backdrop.grain > 0 ? { grain: { opacity: backdrop.grain / 100, size: backdrop.grainScale } } : {}),
    variables,
  }
}
