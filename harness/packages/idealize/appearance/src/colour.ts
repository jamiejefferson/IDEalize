/**
 * Colour arithmetic for the appearance panel: hex parsing, WCAG contrast,
 * sRGB blends (V0's `Theme.blend`), and the deepen-along-hue readability
 * rule. Pure functions over `#RRGGBB` strings; no DOM.
 *
 * The readability rule (V0's Y2K palette note, Theme.swift): a colour that
 * cannot be read against its ground is deepened along its own hue — hue and
 * saturation stay, lightness walks toward black on a light ground or white
 * on a dark one — until it clears the target contrast. It is never
 * desaturated or blended toward grey, so the user's colour keeps its identity.
 */

/** One sRGB colour, channels 0–255. */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** WCAG 2 minimum for body text against its ground. */
export const TEXT_CONTRAST = 4.5

/** WCAG 2 minimum for UI components and large text against their ground. */
export const UI_CONTRAST = 3

/**
 * Parse `#RRGGBB` / `RRGGBB` (case-insensitive, surrounding whitespace
 * tolerated).
 * @param hex - candidate colour string.
 * @returns the colour, or undefined for an empty or malformed string.
 */
export function parseHex(hex: string): Rgb | undefined {
  const match = /^\s*#?([0-9a-f]{6})\s*$/i.exec(hex)
  const digits = match?.[1]
  if (digits === undefined) return undefined
  const value = Number.parseInt(digits, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

/**
 * Parse a hex the caller guarantees is well-formed (preset tables, values
 * already accepted by {@link parseHex}).
 * @param hex - `#RRGGBB` string.
 * @returns the colour.
 */
export function requireHex(hex: string): Rgb {
  const parsed = parseHex(hex)
  if (parsed === undefined) throw new Error(`not a #RRGGBB colour: ${JSON.stringify(hex)}`)
  return parsed
}

/**
 * Format a colour as upper-case `#RRGGBB`.
 * @param rgb - colour; channels are rounded and clamped.
 * @returns the hex string.
 */
export function toHex(rgb: Rgb): string {
  const channel = (value: number): string => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`.toUpperCase()
}

/**
 * Format a colour as `rgba(r, g, b, a)`.
 * @param rgb - colour.
 * @param alpha - opacity 0–1.
 * @returns the CSS rgba() string.
 */
export function toRgba(rgb: Rgb, alpha: number): string {
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${alpha})`
}

/**
 * Linear sRGB blend (V0's `Theme.blend`): t=0 gives `a`, t=1 gives `b`.
 * @param a - start colour.
 * @param b - end colour.
 * @param t - blend fraction 0–1.
 * @returns the blended colour.
 */
export function blend(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

/**
 * WCAG relative luminance of an sRGB colour.
 * @param rgb - colour.
 * @returns luminance 0 (black) to 1 (white).
 */
export function relativeLuminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/**
 * WCAG contrast ratio between two colours.
 * @param a - one colour.
 * @param b - the other colour.
 * @returns ratio 1 (identical) to 21 (black on white).
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Whether a ground reads as dark (V0's `Theme.isDark`: perceived luma below
 * one half).
 * @param ground - the background colour.
 * @returns true for a dark ground.
 */
export function isDark(ground: Rgb): boolean {
  return (0.299 * ground.r + 0.587 * ground.g + 0.114 * ground.b) / 255 < 0.5
}

/** Hue 0–360, saturation and lightness 0–1. */
export interface Hsl {
  h: number
  s: number
  l: number
}

/**
 * Convert sRGB to HSL.
 * @param rgb - colour.
 * @returns the HSL triple (hue 0 for greys).
 */
export function toHsl(rgb: Rgb): Hsl {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

/**
 * Convert HSL to sRGB.
 * @param hsl - hue 0–360, saturation and lightness 0–1.
 * @returns the colour.
 */
export function fromHsl(hsl: Hsl): Rgb {
  const c = (1 - Math.abs(2 * hsl.l - 1)) * hsl.s
  const hp = (hsl.h % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = hsl.l - c / 2
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * The deepen-along-hue rule: return `colour` unchanged when it already reads
 * at `target` against `ground`; otherwise walk its HSL lightness — hue and
 * saturation fixed — toward black (light ground) or white (dark ground) in
 * 0.005 steps and return the first step that reads. When even the extreme
 * fails the target, the extreme is returned.
 * @param colour - the user's colour.
 * @param ground - the ground it must read against.
 * @param target - minimum contrast ratio.
 * @returns a colour of the same hue that clears the target where reachable.
 */
export function deepenAlongHue(colour: Rgb, ground: Rgb, target: number): Rgb {
  if (contrast(colour, ground) >= target) return colour
  const hsl = toHsl(colour)
  const towardWhite = isDark(ground)
  let l = hsl.l
  while (towardWhite ? l < 1 : l > 0) {
    l = towardWhite ? Math.min(1, l + 0.005) : Math.max(0, l - 0.005)
    const candidate = fromHsl({ h: hsl.h, s: hsl.s, l })
    if (contrast(candidate, ground) >= target) return candidate
  }
  return fromHsl({ h: hsl.h, s: hsl.s, l: towardWhite ? 1 : 0 })
}

/**
 * {@link deepenAlongHue} for a colour read against several grounds at once: a
 * gradient's stops, or a ground plus the cards that sit on it. The colour
 * stands when it clears `target` against every ground. Otherwise its HSL
 * lightness walks outward in 0.005 steps in both directions, hue and
 * saturation fixed, and the nearest step that clears every ground wins, so the
 * colour moves as little as it can. When no lightness clears them all, the
 * result is black or white of that hue, whichever keeps the higher worst-case
 * ratio.
 * @param colour - the colour to keep readable.
 * @param grounds - every ground it is read against; at least one.
 * @param target - minimum contrast ratio against each.
 * @returns a colour of the same hue, clearing the target where reachable.
 */
export function deepenAgainstAll(colour: Rgb, grounds: readonly Rgb[], target: number): Rgb {
  const worst = (candidate: Rgb): number => Math.min(...grounds.map(ground => contrast(candidate, ground)))
  if (worst(colour) >= target) return colour
  const hsl = toHsl(colour)
  const at = (l: number): Rgb => fromHsl({ h: hsl.h, s: hsl.s, l: Math.max(0, Math.min(1, l)) })
  for (let step = 1; step <= 200; step += 1) {
    for (const candidate of [at(hsl.l - step * 0.005), at(hsl.l + step * 0.005)]) {
      if (worst(candidate) >= target) return candidate
    }
  }
  const [black, white] = [at(0), at(1)]
  return worst(black) >= worst(white) ? black : white
}
