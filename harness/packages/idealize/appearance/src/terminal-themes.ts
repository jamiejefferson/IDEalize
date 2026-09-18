/**
 * The terminal grid's colour schemes, ported verbatim from V0
 * `Theme.terminalThemes` (Theme.swift): background, foreground, cursor,
 * selection and the 16 ANSI colours of Linen, Ink, Y2K, IDEalize Dark,
 * IDEalize Light and Solarized Dark. The grid keeps its own scheme,
 * independent of the app theme. `resolveTerminalPaint` layers the user's
 * custom background over the chosen theme (V0 `Theme.withBackground`:
 * selection re-derives from the new ground; ink, cursor and palette stay),
 * deepens the selection until it shows ({@link legibleSelection}) and folds in
 * the type settings as the one object the terminal view needs. Classic Dark
 * and Classic Light are V1's own rows: the OG app preset's grounds and inks
 * under the standard terminal palette.
 */

import { blend, contrast, isDark, parseHex, requireHex, toHex, type Rgb } from './colour.ts'
import { TERMINAL_DEFAULTS, type TerminalAppearanceSettings, type TerminalThemeId } from './appearance-settings.ts'

/** One terminal colour scheme. */
export interface TerminalTheme {
  id: TerminalThemeId
  /** Display name (a proper name, shown untranslated like the preset names). */
  name: string
  /** Grid ground `#RRGGBB`. */
  background: string
  /** Body ink. */
  foreground: string
  /** Cursor (V0: also the theme accent). */
  cursor: string
  /** Selection highlight as placed by hand; {@link legibleSelection} deepens it where it cannot be seen. */
  selection: string
  /** The 16 ANSI colours, 0–7 normal and 8–15 bright. */
  ansi: readonly string[]
  /**
   * The stops of V0's background wash, when the theme has one. The grid paints
   * the flat {@link background}; the selection still clears every stop, so the
   * highlight matches V0's and survives the wash being painted.
   */
  wash?: readonly string[]
}

/** The terminal themes in V0's panel order (`[.linen, .ink, .y2k] + all`), then V1's Classic pair. */
export const TERMINAL_THEMES: readonly TerminalTheme[] = Object.freeze([
  {
    id: 'linen',
    name: 'Linen',
    background: '#F7F5F0',
    foreground: '#2A2A27',
    cursor: '#B67A12',
    selection: '#E7E0D1',
    ansi: [
      '#2A2A27', '#B24A44', '#3E7A44', '#8A6A2A', '#4A5A86', '#7A5570', '#3E6C7E', '#64625A',
      '#6A6962', '#A03C36', '#326E3A', '#785C24', '#405078', '#6C4A62', '#346070', '#2A2A27',
    ],
  },
  {
    id: 'ink',
    name: 'Ink',
    background: '#17181A',
    foreground: '#E6E7E9',
    cursor: '#E8B84B',
    selection: '#2E2F33',
    ansi: [
      '#3C3E42', '#DA8A86', '#88C08C', '#D9C089', '#A9B7D8', '#C9A9C4', '#9CB8C8', '#C9CBCF',
      '#787A7E', '#E69692', '#96CD9A', '#E4CD96', '#B8C6E4', '#D6B8D1', '#ACC6D6', '#F0F1F3',
    ],
  },
  {
    // V0 paints Y2K over a pink→periwinkle wash; the flat port keeps the
    // wash's midpoint as the ground (Theme.swift documents it as such).
    id: 'y2k',
    name: 'Y2K',
    background: '#DBACE3',
    foreground: '#AB008E',
    cursor: '#FF74E7',
    selection: '#AFCAB9',
    ansi: [
      '#28484E', '#EB1800', '#00867A', '#A16C00', '#0D6EFF', '#AF30FF', '#008580', '#AB008E',
      '#BD37A6', '#FF7186', '#05FC8C', '#FFD98A', '#A9CBFF', '#FF74E7', '#00F2DA', '#FFFFFF',
    ],
    wash: ['#FD85CA', '#B7D2FB'],
  },
  {
    id: 'idealize-dark',
    name: 'IDEalize Dark',
    background: '#2F353C',
    foreground: '#D5DDE3',
    cursor: '#85C1B4',
    selection: '#444E58',
    ansi: [
      '#4A525A', '#E08A7D', '#94C090', '#DEC68C', '#84AACE', '#BA9EC4', '#85C1B4', '#C8D0D6',
      '#7A848D', '#ECA094', '#A8D2A4', '#E9D6A0', '#9ABCDC', '#CCB2D6', '#9ED2C6', '#EEF3F6',
    ],
  },
  {
    id: 'idealize-light',
    name: 'IDEalize Light',
    background: '#FFFFFF',
    foreground: '#24292F',
    cursor: '#0969DA',
    selection: '#CCE4FF',
    ansi: [
      '#24292F', '#CF222E', '#1A7F37', '#9A6700', '#0969DA', '#8250DF', '#1F8899', '#6E7781',
      '#57606A', '#A40E26', '#1A7F37', '#9A6700', '#0969DA', '#8250DF', '#1F8899', '#0D1117',
    ],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    background: '#002B36',
    foreground: '#839496',
    cursor: '#839496',
    selection: '#073642',
    ansi: [
      '#073642', '#DC322F', '#859900', '#B58900', '#268BD2', '#D33682', '#2AA198', '#EEE8D5',
      '#002B36', '#CB4B16', '#586E75', '#657B83', '#839496', '#6C71C4', '#93A1A1', '#FDF6E3',
    ],
  },
  {
    // The OG app preset's dark side (#1B1D21 / #E8E9EB) under the standard
    // terminal palette, for anyone the designed themes do not suit. Bright
    // black is lifted from the stock #666666 (2.97:1) so every slot but black
    // reads at 3:1 on the ground.
    id: 'classic-dark',
    name: 'Classic Dark',
    background: '#1B1D21',
    foreground: '#E8E9EB',
    cursor: '#E8E9EB',
    selection: '#3A3D44',
    ansi: [
      '#000000', '#CD3131', '#0DBC79', '#E5E510', '#2472C8', '#BC3FBC', '#11A8CD', '#E5E5E5',
      '#7A7A7A', '#F14C4C', '#23D18B', '#F5F543', '#3B8EEA', '#D670D6', '#29B8DB', '#FFFFFF',
    ],
  },
  {
    // The OG preset's light side (#FFFFFF / #1F2328). The standard palette's
    // hues, each dark enough to read at 3:1 on white; bright white stays a
    // pale grey, the ground's own end of the palette.
    id: 'classic-light',
    name: 'Classic Light',
    background: '#FFFFFF',
    foreground: '#1F2328',
    cursor: '#1F2328',
    selection: '#ADD6FF',
    ansi: [
      '#000000', '#CD3131', '#107C10', '#8A6A00', '#0451A5', '#BC05BC', '#0B7C8E', '#555555',
      '#666666', '#E0383E', '#1A9E1A', '#A07D00', '#1A6FD6', '#D03FD0', '#0E96AB', '#A5A5A5',
    ],
  },
])

/**
 * Look up a terminal theme.
 * @param id - theme id (the schema bounds stored values to known ids).
 * @returns the theme.
 */
export function terminalTheme(id: TerminalThemeId): TerminalTheme {
  const entry = TERMINAL_THEMES.find(candidate => candidate.id === id)
  /* v8 ignore next -- TerminalThemeId is the union of TERMINAL_THEMES ids; the throw only names a table/type drift. */
  if (entry === undefined) throw new Error(`unknown terminal theme ${JSON.stringify(id)}`)
  return entry
}

/**
 * Everything the terminal view needs to paint one grid: the resolved colours
 * plus the type settings. `@idealize/ui-terminal` reads it through
 * `ctx.appearance.terminalPaint()` (services, not value imports, carry
 * cross-plugin collaboration).
 */
export interface TerminalPaint {
  /** Grid ground `#RRGGBB` (also paints the margin). */
  background: string
  /** Body ink. */
  foreground: string
  /** Cursor colour (the cursor is always V0's bar style; no setting). */
  cursor: string
  /** Selection highlight, deepened by {@link legibleSelection}. */
  selection: string
  /** The colour selected text is drawn in: the ink or the ground, whichever reads better on {@link selection}. */
  selectionForeground: string
  /** The 16 ANSI colours, 0–7 normal and 8–15 bright. */
  ansi: readonly string[]
  /** CSS font-family stack, monospace-terminated. */
  fontFamily: string
  /** Grid font size in px. */
  fontSize: number
  /** Line height as a multiple of the font's natural height (xterm `lineHeight`). */
  lineHeight: number
  /** Padding around the grid in px, painted in {@link background}. */
  margin: number
}

/**
 * A CSS font-family value for a terminal family, quoted and followed by the
 * platform monospace stack so a missing face degrades to a working grid.
 * @param family - font family name; empty means the default stack.
 * @returns the font-family value.
 */
export function terminalFontStack(family: string): string {
  const fallback = 'ui-monospace, \'SF Mono\', Menlo, Consolas, monospace'
  const trimmed = family.trim()
  if (trimmed === '') return fallback
  return `${JSON.stringify(trimmed)}, ${fallback}`
}

/** How far the selection highlight must stand off every ground stop (V0 `Theme.selectionContrast`). */
export const SELECTION_CONTRAST = 1.5

/** How readable the theme's ink or ground must be on the highlight (V0 `Theme.selectionTextContrast`). */
export const SELECTION_TEXT_CONTRAST = 3

/** The colours {@link legibleSelection} reads a selection against. */
export interface SelectionGround {
  /** Every ground the grid paints: the flat ground plus any wash stops. */
  grounds: readonly Rgb[]
  /** Body ink. */
  foreground: Rgb
  /** The flat ground, the other candidate for selected text. */
  background: Rgb
  /** The 16 ANSI colours; slot 0 (light ground) or 15 (dark ground) is the colour the walk heads for. */
  ansi: readonly string[]
}

/** A selection highlight and the text colour drawn on it. */
export interface LegibleSelection {
  /** The highlight. */
  selection: Rgb
  /** The ink or the ground, whichever the highlight carries better. */
  foreground: Rgb
}

/**
 * V0's selection rule (`Theme.selectionColor`, `selectedTextColor`). The
 * theme's own selection colour stands when it clears
 * {@link SELECTION_CONTRAST} against every ground stop and the ink or the
 * ground reads on it at {@link SELECTION_TEXT_CONTRAST}. Otherwise it walks in
 * 0.005 blend steps toward the theme's own black slot (its bright-white slot
 * on a dark ground), so each step mixes two colours the theme already owns,
 * and returns the first step that passes both. A palette that cannot reach
 * continues to pure black or white.
 * @param selection - the hand-placed selection colour.
 * @param ground - the grounds, ink and palette it is read against.
 * @returns the highlight and the selected-text colour.
 */
export function legibleSelection(selection: Rgb, ground: SelectionGround): LegibleSelection {
  const dark = isDark(ground.background)
  const pure: Rgb = dark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 }
  const slot = parseHex(ground.ansi[dark ? 15 : 0] ?? '') ?? pure
  const legible = (candidate: Rgb): boolean =>
    ground.grounds.every(stop => contrast(candidate, stop) >= SELECTION_CONTRAST)
    && Math.max(contrast(ground.foreground, candidate), contrast(ground.background, candidate)) >= SELECTION_TEXT_CONTRAST
  const walk = (target: Rgb): Rgb | undefined => {
    for (let step = 0; step <= 200; step += 1) {
      const candidate = blend(selection, target, step / 200)
      if (legible(candidate)) return candidate
    }
    return undefined
  }
  const highlight = walk(slot) ?? walk(pure) ?? pure
  const foreground = contrast(ground.foreground, highlight) >= contrast(ground.background, highlight)
    ? ground.foreground
    : ground.background
  return { selection: highlight, foreground }
}

/**
 * Resolve the stored terminal settings into the paint object. A parsable
 * custom background replaces the theme's ground, drops its wash and re-derives
 * the selection from it (V0 `withBackground`'s 0.14 ink blend); the selection
 * then passes through {@link legibleSelection}. Everything else is the theme's
 * own.
 * @param settings - the durable terminal section.
 * @returns the resolved paint.
 */
export function resolveTerminalPaint(settings: TerminalAppearanceSettings = TERMINAL_DEFAULTS): TerminalPaint {
  const theme = terminalTheme(settings.theme)
  const custom = parseHex(settings.bgHex)
  const foreground = requireHex(theme.foreground)
  const background = custom ?? requireHex(theme.background)
  const placed = custom === undefined ? requireHex(theme.selection) : blend(custom, foreground, 0.14)
  const grounds = custom === undefined ? [...(theme.wash ?? []).map(requireHex), background] : [background]
  const legible = legibleSelection(placed, { grounds, foreground, background, ansi: theme.ansi })
  return {
    background: toHex(background),
    foreground: theme.foreground,
    cursor: theme.cursor,
    selection: toHex(legible.selection),
    selectionForeground: toHex(legible.foreground),
    ansi: theme.ansi,
    fontFamily: terminalFontStack(settings.fontName),
    fontSize: settings.fontSize,
    lineHeight: settings.lineSpacing,
    margin: settings.margin,
  }
}
