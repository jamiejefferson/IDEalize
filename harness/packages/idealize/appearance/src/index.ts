/**
 * @idealize/appearance — Host half of the appearance panel: registers the
 * durable `idealize-appearance` settings section (preset, interface font and
 * size, the action colour, the user's ground, per-surface overrides, the
 * chat panel scalars), bootstraps font and size into the served index, and
 * serves the installed font families for the pickers:
 * - `GET /idealize/appearance/fonts` — `{ families: string[], monospaced:
 *   string[] }`, loopback only.
 * The panel itself is the browser half (`./client`).
 * @module @idealize/appearance
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  APPEARANCE_DEFAULTS, APPEARANCE_SETTINGS_NAMESPACE, AppearanceSettingsSchema, type AppearanceSettings,
} from './appearance-settings.ts'
import { injectBootAppearance } from './boot-appearance.ts'
import { listFontFamilies, type FontInventory } from './fonts.ts'

export {
  actionCustomised, APPEARANCE_DEFAULTS, APPEARANCE_SETTINGS_NAMESPACE, AppearanceSettingsSchema, EMPTY_ACTION,
  EMPTY_SURFACE, FILL_MODES, FONT_WEIGHTS, fontStack, GRADIENT_TYPES, PRESETS, SURFACES, surfaceCustomised,
  TERMINAL_DEFAULTS, TERMINAL_THEME_IDS, terminalCustomised, uiScale,
  type ActionAppearance, type AppearanceSettings, type FillMode, type GradientStop, type GradientType, type PresetId,
  type SurfaceAppearance, type SurfaceId, type TerminalAppearanceSettings, type TerminalThemeId,
} from './appearance-settings.ts'
export {
  resolveTerminalPaint, TERMINAL_THEMES, terminalFontStack, terminalTheme,
  type TerminalPaint, type TerminalTheme,
} from './terminal-themes.ts'
export {
  actionAccent, actionTokens, appearanceStylesheet, panelScalarsCss, COMPOSER_ATTRIBUTE, gradientCss, seedStops,
  SURFACE_ATTRIBUTE, SURFACE_BASE_SIZE, SURFACE_EXEMPT_ATTRIBUTE, surfaceCss, type ActionAccent, type SurfaceDefaults,
} from './surface-css.ts'
export { familiesInFile, familyOfFace, fontDirectories, isFixedPitchFace, listFontFamilies, type FontInventory } from './fonts.ts'
export {
  CRISP_BORDER_STEP, CRISP_SECONDARY_BLEND, deriveTokens, hoverOf, onFill, PRESET_LIST, PRESET_TOKEN_KEYS, preset,
  presetPalette, resolveAppearance, surfaceHex, tokenDeclarations, type Palette, type Preset, type Resolved,
  type ResolvedScheme, type Tokens,
} from './presets.ts'
export { contrast, deepenAlongHue, parseHex, toHex, TEXT_CONTRAST, UI_CONTRAST } from './colour.ts'
export { BOOT_STYLE_ID, injectBootAppearance } from './boot-appearance.ts'

const NAMESPACE = settingsNamespace(APPEARANCE_SETTINGS_NAMESPACE)

/** Refuse anything that is not a loopback request. */
function refuse(req: IncomingMessage, res: ServerResponse): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  return false
}

/** Read the registered section or use the schema defaults without a settings provider. */
function readSection(ctx: Context): AppearanceSettings {
  const settings = ctx.get('settings')
  if (settings === undefined) return APPEARANCE_DEFAULTS
  const section = settings.get(NAMESPACE) as AppearanceSettings | undefined
  return section ?? APPEARANCE_DEFAULTS
}

/**
 * Register the durable appearance section, the index bootstrap and the font
 * route when their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NAMESPACE, AppearanceSettingsSchema)
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectBootAppearance(html, readSection(ctx))),
      'idealize-appearance: font/size bootstrap',
    )
    // Scanned once per process: the font directories change only on install.
    let families: Promise<FontInventory> | undefined
    httpCtx.effect(
      () => httpCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/appearance/fonts',
        handler: async (req, res) => {
          if (refuse(req, res)) return
          families ??= listFontFamilies()
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await families))
        },
      }),
      'idealize-appearance: /idealize/appearance/fonts',
    )
  })
}
