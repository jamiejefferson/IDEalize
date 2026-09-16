/**
 * The appearance section of the Host user-settings document — V0's
 * AppSettings appearance fields (AppearanceDefaults, PanelAppearance,
 * ActionAppearance) carried over: preset, interface font and size, the
 * action colour, the user's ground, one typography + background override per
 * surface, and the chat panel's own scalars. Light/dark/system stays in
 * ui-theme's own `ui-theme.preference` field; this section layers over it.
 */

import z from '@deepseek-ai/schemastery'
import { isDark, parseHex } from './colour.ts'

/** Settings namespace owned by the appearance plugin. */
export const APPEARANCE_SETTINGS_NAMESPACE = 'idealize-appearance'

/** App presets offered by the panel. */
export const PRESETS = ['idealize', 'og', 'ink', 'linen'] as const

/** One of {@link PRESETS}. */
export type PresetId = typeof PRESETS[number]

/**
 * The individually themeable surfaces (V0 PanelKind minus the terminal, which
 * the web shell does not host): the projects rail, the files drawer, the
 * chat column, the document deck.
 */
export const SURFACES = ['sessions', 'files', 'chat', 'doc'] as const

/** One of {@link SURFACES}. */
export type SurfaceId = typeof SURFACES[number]

/** How a surface background is filled (V0 FillMode). */
export const FILL_MODES = ['inherit', 'solid', 'gradient'] as const

/** One of {@link FILL_MODES}. */
export type FillMode = typeof FILL_MODES[number]

/** Gradient shapes (V0 GradientType). */
export const GRADIENT_TYPES = ['linear', 'radial', 'angular'] as const

/** One of {@link GRADIENT_TYPES}. */
export type GradientType = typeof GRADIENT_TYPES[number]

/** V0 AppearanceWeights: 0 inherits, 1–9 map to CSS 100–900. */
export const FONT_WEIGHTS = ['inherit', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const

/** One colour stop of a multi-stop gradient. */
export interface GradientStop {
  /** `#RRGGBB`. */
  colorHex: string
  /** Position 0–1. */
  location: number
}

/** The scheme a surface's colours belong to; `''` on a record written before the field existed. */
export type SurfaceScheme = '' | 'light' | 'dark'

/**
 * Per-surface typography + background override; every field defaults to
 * "inherit". The colours (text and background) belong to the scheme they were
 * chosen in ({@link surfaceScheme}) and paint only there: a light ground and
 * black ink picked over the light theme would leave the dark theme's own
 * chrome unreadable (JJ, 15 Sep 2026), so the other scheme keeps its own
 * colours until the person picks some for it. Typography applies in both.
 */
export interface SurfaceAppearance {
  /** Font family; empty inherits the interface font. */
  fontName: string
  /** Font size in points; 0 keeps the surface's natural size. */
  fontSize: number
  /** 0 inherits; 1–9 are CSS weights 100–900. */
  fontWeight: number
  /** Letter-spacing in px. */
  tracking: number
  /** Extra line spacing in px. */
  lineSpacing: number
  /** Text colour; empty keeps the theme ink. */
  textColorHex: string
  /** Background fill mode. */
  bgMode: FillMode
  /** Solid fill colour; empty keeps the theme ground. */
  bgColorHex: string
  /** Linear/angular gradient angle in degrees. */
  gradientAngle: number
  /** Background opacity 0–1. */
  bgOpacity: number
  /** Gradient shape. */
  bgGradientType: GradientType
  /** Gradient stops; empty seeds from the theme's ground and surface. */
  bgGradientStops: GradientStop[]
  /** The scheme the text and background colours were chosen in; `''` reads it from the colours. */
  scheme: SurfaceScheme
}

/** The colour fields of a surface, the ones {@link surfaceScheme} binds to one scheme. */
export const SURFACE_COLOUR_FIELDS = ['textColorHex', 'bgMode', 'bgColorHex', 'bgGradientStops', 'scheme'] as const

/**
 * Whether a surface carries a text colour or a background of its own.
 * @param surface - the override.
 * @returns true when either is set.
 */
export function surfaceColoured(surface: SurfaceAppearance): boolean {
  return surface.textColorHex !== '' || surface.bgMode !== 'inherit'
}

/**
 * The scheme a surface's colours paint in: the recorded one, or, for a record
 * written before the field existed, the scheme its colours were evidently
 * chosen over — a dark background or a light ink means dark, otherwise light.
 * @param surface - the override.
 * @returns the scheme, or undefined for a surface with no colours.
 */
export function surfaceScheme(surface: SurfaceAppearance): 'light' | 'dark' | undefined {
  if (!surfaceColoured(surface)) return undefined
  if (surface.scheme !== '') return surface.scheme
  const ground = surface.bgMode === 'solid'
    ? parseHex(surface.bgColorHex)
    : surface.bgMode === 'gradient'
      ? surface.bgGradientStops.map(stop => parseHex(stop.colorHex)).find(rgb => rgb !== undefined)
      : undefined
  if (ground !== undefined) return isDark(ground) ? 'dark' : 'light'
  const ink = parseHex(surface.textColorHex)
  if (ink !== undefined) return isDark(ink) ? 'light' : 'dark'
  return 'light'
}

/**
 * The surface with its colours returned to the theme's own; typography stays.
 * @param surface - the override.
 * @returns the surface without text colour, background or scheme.
 */
export function clearSurfaceColours(surface: SurfaceAppearance): SurfaceAppearance {
  return {
    ...surface,
    textColorHex: EMPTY_SURFACE.textColorHex,
    bgMode: EMPTY_SURFACE.bgMode,
    bgColorHex: EMPTY_SURFACE.bgColorHex,
    gradientAngle: EMPTY_SURFACE.gradientAngle,
    bgOpacity: EMPTY_SURFACE.bgOpacity,
    bgGradientType: EMPTY_SURFACE.bgGradientType,
    bgGradientStops: [],
    scheme: EMPTY_SURFACE.scheme,
  }
}

/** Terminal theme ids in V0's panel order (`Theme.terminalThemes`); the colour tables live in `terminal-themes.ts`. */
export const TERMINAL_THEME_IDS = ['linen', 'ink', 'y2k', 'idealize-dark', 'idealize-light', 'solarized-dark'] as const

/** One of {@link TERMINAL_THEME_IDS}. */
export type TerminalThemeId = typeof TERMINAL_THEME_IDS[number]

/**
 * The terminal grid's own appearance (V0 AppSettings terminal fields),
 * independent of the app theme. The cursor is V0's bar in the theme's cursor
 * colour and carries no setting.
 */
export interface TerminalAppearanceSettings {
  /** Selected terminal theme. */
  theme: TerminalThemeId
  /** Custom grid background `#RRGGBB`, or empty for the theme's own. */
  bgHex: string
  /** Grid font family (V0 `fontName`). */
  fontName: string
  /** Grid font size in px, 9–28 (V0 `fontSize`). */
  fontSize: number
  /** Line height as a multiple of the font's natural height, 1–3 (V0 `terminalLineSpacing`). */
  lineSpacing: number
  /** Padding around the grid in px, 0–80, painted in the terminal ground (V0 `terminalMargin`). */
  margin: number
}

/** The terminal section as it ships (V0 AppearanceDefaults). */
export const TERMINAL_DEFAULTS: TerminalAppearanceSettings = Object.freeze({
  theme: 'linen',
  bgHex: '',
  fontName: 'DM Mono',
  fontSize: 14,
  lineSpacing: 1,
  margin: 36,
})

/**
 * Whether the terminal section differs from its defaults. The theme *choice*
 * does not count and Reset keeps it (V0's rule: choices are never reset,
 * only the values layered over them).
 * @param terminal - the terminal section.
 * @returns true when any non-theme field is set.
 */
export function terminalCustomised(terminal: TerminalAppearanceSettings): boolean {
  return JSON.stringify({ ...terminal, theme: TERMINAL_DEFAULTS.theme }) !== JSON.stringify(TERMINAL_DEFAULTS)
}

/** The global action colour for primary buttons and selection highlights (V0 ActionAppearance). */
export interface ActionAppearance {
  /** `solid` or `gradient`. */
  mode: 'solid' | 'gradient'
  /** Solid colour; empty keeps the theme accent. */
  colorHex: string
  /** Gradient angle in degrees. */
  angle: number
  /** Opacity 0–1. */
  opacity: number
  /** Gradient shape. */
  gradientType: GradientType
  /** Gradient stops; empty seeds from the theme accent. */
  gradientStops: GradientStop[]
}

/** Durable appearance section. */
export interface AppearanceSettings {
  /** Selected app preset. */
  preset: PresetId
  /** Interface font family; empty is the platform UI stack. */
  uiFont: string
  /** Interface size in points; 13 is the unscaled default. */
  uiSize: number
  /** The user's own ground colour as `#RRGGBB`, or empty for the preset's. */
  groundHex: string
  /** The action colour. */
  action: ActionAppearance
  /** The terminal grid's own appearance. */
  terminal: TerminalAppearanceSettings
  /** Per-surface overrides. */
  surfaces: Record<SurfaceId, SurfaceAppearance>
  /** Composer card opacity 0.3–1. */
  chatInputOpacity: number
  /** Composer shadow strength 0–0.8. */
  chatShadowOpacity: number
  /** Chat margins in px, 8–40. */
  chatMargin: number
  /** Document view margins in px, 0–64. */
  docMargin: number
}

/** V0's interface size default (AppearanceDefaults.uiFontSize). */
export const DEFAULT_UI_SIZE = 13

/** V0's interface size range (Appearance ▸ Interface size slider). */
export const UI_SIZE_MIN = 10

/** Upper bound of the interface size slider. */
export const UI_SIZE_MAX = 18

/** An untouched surface. */
export const EMPTY_SURFACE: SurfaceAppearance = Object.freeze({
  fontName: '',
  fontSize: 0,
  fontWeight: 0,
  tracking: 0,
  lineSpacing: 0,
  textColorHex: '',
  bgMode: 'inherit',
  bgColorHex: '',
  gradientAngle: 90,
  bgOpacity: 1,
  bgGradientType: 'linear',
  bgGradientStops: [],
  scheme: '',
})

/** The theme's own action colour. */
export const EMPTY_ACTION: ActionAppearance = Object.freeze({
  mode: 'solid',
  colorHex: '',
  angle: 90,
  opacity: 1,
  gradientType: 'linear',
  gradientStops: [],
})

/** Defaults applied when the document has no override (V0 AppearanceDefaults). */
export const APPEARANCE_DEFAULTS: AppearanceSettings = Object.freeze({
  preset: 'idealize',
  uiFont: '',
  uiSize: DEFAULT_UI_SIZE,
  groundHex: '',
  action: EMPTY_ACTION,
  terminal: TERMINAL_DEFAULTS,
  surfaces: Object.freeze({
    sessions: EMPTY_SURFACE,
    files: EMPTY_SURFACE,
    chat: EMPTY_SURFACE,
    doc: EMPTY_SURFACE,
  }),
  chatInputOpacity: 1,
  chatShadowOpacity: 0.4,
  chatMargin: 18,
  docMargin: 14,
})

const GradientStopSchema: z<GradientStop> = z.object({
  colorHex: z.string().default('#888888'),
  location: z.number().min(0).max(1).default(0),
})

const SurfaceSchema: z<SurfaceAppearance> = z.object({
  fontName: z.string().default(''),
  fontSize: z.number().min(0).max(28).default(0),
  fontWeight: z.natural().max(9).default(0),
  tracking: z.number().min(-2).max(8).default(0),
  lineSpacing: z.number().min(0).max(16).default(0),
  textColorHex: z.string().default(''),
  bgMode: z.union([...FILL_MODES]).default('inherit'),
  bgColorHex: z.string().default(''),
  gradientAngle: z.number().min(0).max(360).default(90),
  bgOpacity: z.number().min(0).max(1).default(1),
  bgGradientType: z.union([...GRADIENT_TYPES]).default('linear'),
  bgGradientStops: z.array(GradientStopSchema).default([]),
  scheme: z.union(['', 'light', 'dark']).default(''),
})

const TerminalSchema: z<TerminalAppearanceSettings> = z.object({
  theme: z.union([...TERMINAL_THEME_IDS]).default(TERMINAL_DEFAULTS.theme),
  bgHex: z.string().default(''),
  fontName: z.string().default(TERMINAL_DEFAULTS.fontName),
  fontSize: z.number().min(9).max(28).default(TERMINAL_DEFAULTS.fontSize),
  lineSpacing: z.number().min(1).max(3).default(TERMINAL_DEFAULTS.lineSpacing),
  margin: z.number().min(0).max(80).default(TERMINAL_DEFAULTS.margin),
})

const ActionSchema: z<ActionAppearance> = z.object({
  mode: z.union(['solid', 'gradient']).default('solid'),
  colorHex: z.string().default(''),
  angle: z.number().min(0).max(360).default(90),
  opacity: z.number().min(0).max(1).default(1),
  gradientType: z.union([...GRADIENT_TYPES]).default('linear'),
  gradientStops: z.array(GradientStopSchema).default([]),
})

/** Durable schema; also the wire envelope the browser scope validates against. */
export const AppearanceSettingsSchema: z<AppearanceSettings> = z.object({
  preset: z.union([...PRESETS]).default(APPEARANCE_DEFAULTS.preset),
  uiFont: z.string().default(''),
  uiSize: z.number().min(UI_SIZE_MIN).max(UI_SIZE_MAX).default(DEFAULT_UI_SIZE),
  groundHex: z.string().default(''),
  action: ActionSchema.default({ ...EMPTY_ACTION }),
  terminal: TerminalSchema.default({ ...TERMINAL_DEFAULTS }),
  surfaces: z.object({
    sessions: SurfaceSchema.default({ ...EMPTY_SURFACE }),
    files: SurfaceSchema.default({ ...EMPTY_SURFACE }),
    chat: SurfaceSchema.default({ ...EMPTY_SURFACE }),
    doc: SurfaceSchema.default({ ...EMPTY_SURFACE }),
  }).default({
    sessions: { ...EMPTY_SURFACE },
    files: { ...EMPTY_SURFACE },
    chat: { ...EMPTY_SURFACE },
    doc: { ...EMPTY_SURFACE },
  }),
  chatInputOpacity: z.number().min(0.3).max(1).default(APPEARANCE_DEFAULTS.chatInputOpacity),
  chatShadowOpacity: z.number().min(0).max(0.8).default(APPEARANCE_DEFAULTS.chatShadowOpacity),
  chatMargin: z.number().min(8).max(40).default(APPEARANCE_DEFAULTS.chatMargin),
  docMargin: z.number().min(0).max(64).default(APPEARANCE_DEFAULTS.docMargin),
})

/** The platform UI stack ui-theme's base sheet declares (what an empty `uiFont` means). */
export const SYSTEM_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif"

/**
 * A CSS font-family value for a family name, quoted and followed by the
 * platform stack so a missing face degrades to the default.
 * @param family - font family name; empty means the platform stack.
 * @returns the font-family value.
 */
export function fontStack(family: string): string {
  const trimmed = family.trim()
  if (trimmed === '') return SYSTEM_FONT_STACK
  return `${JSON.stringify(trimmed)}, ${SYSTEM_FONT_STACK}`
}

/**
 * The zoom factor an interface size maps to: V0 scaled every interface font
 * by `uiFontSize / 13`; the web shell scales its root the same way.
 * @param uiSize - interface size in points.
 * @returns the scale factor, 1 at the default.
 */
export function uiScale(uiSize: number): number {
  return Math.round((uiSize / DEFAULT_UI_SIZE) * 1000) / 1000
}

/**
 * Whether a surface override differs from "inherit everything".
 * @param surface - the override.
 * @returns true when any field is set.
 */
export function surfaceCustomised(surface: SurfaceAppearance): boolean {
  return JSON.stringify(surface) !== JSON.stringify(EMPTY_SURFACE)
}

/**
 * Whether the action colour differs from the theme's own.
 * @param action - the action appearance.
 * @returns true when any field is set.
 */
export function actionCustomised(action: ActionAppearance): boolean {
  return JSON.stringify(action) !== JSON.stringify(EMPTY_ACTION)
}
