/**
 * IDEalize appearance panel, browser half. Owns the `idealize-appearance`
 * settings scope and projects it onto the app: preset, ground and action
 * colour as a ui-theme override layer (both schemes, so a layer never goes
 * illegible on a mode switch; every preset, IDEalize included, lays the full
 * `PRESET_TOKEN_KEYS` set), the interface font through the same layer,
 * interface size as a root zoom, and the per-surface typography, backgrounds
 * and chat-panel scalars as one injected stylesheet over the frame's
 * `data-idealize-surface` hooks. The panel itself is seated by a host: the
 * tool rail shows it as a pane of the docked drawer. Light/dark/system stays
 * ui-theme's preference, written through `ctx.theme.setTheme`.
 *
 * `ctx.appearance` is the cross-plugin face: `open()`/`toggle()` flip the
 * store's `open` flag, and `Component` + `face()` + `store` let the host seat
 * the panel and follow that flag. V0's ⌘⌥A (Ctrl+Alt+A elsewhere) toggles it.
 */
import type React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the ctx.theme Context merge and the snapshot types.
import type { ThemeSnapshot, ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: the ui-layout SlotMap merge (the drawer seat the panel's props are typed against).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  actionCustomised, APPEARANCE_DEFAULTS, APPEARANCE_SETTINGS_NAMESPACE, clearSurfaceColours, EMPTY_ACTION, EMPTY_SURFACE,
  fontStack, SURFACE_COLOUR_FIELDS, surfaceColoured, SURFACES, TERMINAL_DEFAULTS, uiScale,
  type ActionAppearance, type AppearanceSettings, type PresetId, type SurfaceAppearance, type SurfaceId,
  type TerminalAppearanceSettings,
} from '../appearance-settings.ts'
import { resolveTerminalPaint, type TerminalPaint } from '../terminal-themes.ts'
import { resolveAppearance, surfaceHex, type Tokens } from '../presets.ts'
import { actionTokens, appearanceStylesheet, type PanelScalars } from '../surface-css.ts'
import { AppearancePanel, type AppearancePanelComponentProps, type AppearancePanelInjected } from './AppearancePanel.tsx'
import { applyAppearanceDom } from './dom-applier.ts'
import { createAppearanceStore, type AppearanceStore, type ModeId, type SectionId } from './store.ts'
import { en, zh, type AppearanceKey } from './locales.ts'

export { AppearancePanel } from './AppearancePanel.tsx'
export type { AppearancePanelComponentProps, AppearancePanelInjected, AppearancePanelProps } from './AppearancePanel.tsx'
export { createAppearanceStore, SECTIONS } from './store.ts'
export type { AppearanceState, AppearanceStore, ModeId, SectionId } from './store.ts'
export type { AppearanceKey } from './locales.ts'
export { applyAppearanceDom } from './dom-applier.ts'
// The paint object `@idealize/ui-terminal` reads through `ctx.appearance` (type-only there).
export type { TerminalPaint, TerminalTheme } from '../terminal-themes.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The appearance panel's copy. */
    'idealize-appearance': AppearanceKey
  }
}

/** The appearance face other plugins reach (`ctx.appearance`): open the panel, or host it. */
export interface AppearanceService {
  /** Show the panel. */
  open: () => void
  /** Hide the panel. */
  close: () => void
  /** Show or hide the panel. */
  toggle: () => void
  /** Whether the panel is shown. */
  isOpen: () => boolean
  /** The panel component; the host (the drawer) seats it and renders it while {@link store} says open. */
  Component: (props: AppearancePanelComponentProps) => React.JSX.Element | null
  /** The wired face for {@link Component}; a host binds `useAppearance` from {@link store} and supplies its own `t`. */
  face: () => AppearancePanelInjected
  /** The panel's state store. */
  store: AppearanceStore
  /**
   * The terminal grid's resolved appearance under the current settings.
   * `@idealize/ui-terminal` reads it here and re-reads on {@link store}
   * changes; the terminal keeps its own scheme, independent of the app theme.
   * @returns the resolved paint.
   */
  terminalPaint: () => TerminalPaint
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    appearance: AppearanceService
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-appearance'

/** Override-layer source id registered with ui-theme. */
const LAYER_SOURCE = 'idealize-appearance'

/** Id of the injected per-surface stylesheet. */
export const SHEET_ID = 'idealize-appearance-surfaces'

/** Host route serving the installed font families. */
const FONTS_ROUTE = '/idealize/appearance/fonts'

/** Required services: locale for the panel's copy, settings transport, the theme registry. */
export const inject = ['locale', 'settingsScope', 'theme']

/**
 * Open the appearance panel from any plugin that injects `appearance`.
 * @param ctx - a context that has acquired the `appearance` service.
 */
export function openAppearancePanel(ctx: Context): void {
  ctx.appearance.open()
}

/** The Host's font listing, narrowed from JSON. */
function inventoryOf(body: unknown): { families: string[]; monospaced: string[] } {
  const list = (key: string): string[] => {
    if (typeof body !== 'object' || body === null) return []
    const value: unknown = Reflect.get(body, key)
    return Array.isArray(value) ? value.filter((family): family is string => typeof family === 'string') : []
  }
  return { families: list('families'), monospaced: list('monospaced') }
}

/**
 * Client plugin body: the appearance service and the settings projection.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-appearance: dictionaries')

  const store = createAppearanceStore()
  const scope = ctx.settingsScope.bind<AppearanceSettings>({ namespace: APPEARANCE_SETTINGS_NAMESPACE })
  const current = (): AppearanceSettings => store.getSnapshot().settings

  // ── projection ────────────────────────────────────────────────────────
  const tokensFor = (settings: AppearanceSettings, scheme: 'light' | 'dark'): Tokens => {
    const side = resolveAppearance(settings.preset, settings.groundHex, settings.action.colorHex)[scheme]
    const action = actionCustomised(settings.action)
      ? actionTokens(settings.action, side.palette.accent, side.palette.ground, side.palette.ink)
      : {}
    return { ...side.tokens, ...action }
  }
  let layer: (() => void) | undefined
  const layTokens = (settings: AppearanceSettings): void => {
    const light = tokensFor(settings, 'light')
    const dark = tokensFor(settings, 'dark')
    // Both sides derive from the same resolver, so their key sets match.
    const tokens: ThemeTokenOverrides = {}
    for (const [name, l] of Object.entries(light)) {
      const d = dark[name]
      /* v8 ignore next -- both sides come from the same resolver and carry the same keys. */
      if (d !== undefined) tokens[name] = { light: l, dark: d }
    }
    if (settings.uiFont.trim() !== '') {
      const stack = fontStack(settings.uiFont)
      tokens['--dsw-font-family'] = { light: stack, dark: stack }
    }
    if (Object.keys(tokens).length === 0) {
      layer?.()
      layer = undefined
    } else {
      layer = ctx.theme.overrideTokens(LAYER_SOURCE, tokens)
    }
  }
  let sheet: HTMLStyleElement | undefined
  const laySheet = (settings: AppearanceSettings, scheme: 'light' | 'dark'): void => {
    const side = resolveAppearance(settings.preset, settings.groundHex, settings.action.colorHex)[scheme]
    const text = appearanceStylesheet(settings.surfaces, settings, {
      ground: side.palette.ground,
      surface: surfaceHex(side),
      tokens: side.tokens,
      scheme,
    })
    if (text === '') {
      sheet?.remove()
      sheet = undefined
      return
    }
    if (sheet === undefined) {
      sheet = document.createElement('style')
      sheet.id = SHEET_ID
      document.head.append(sheet)
    }
    sheet.textContent = text
  }
  const project = (settings: AppearanceSettings): void => {
    layTokens(settings)
    laySheet(settings, store.getSnapshot().scheme)
    applyAppearanceDom(document, uiScale(settings.uiSize))
  }
  ctx.effect(() => () => {
    layer?.()
    layer = undefined
    sheet?.remove()
    sheet = undefined
    applyAppearanceDom(document, 1)
  }, 'idealize-appearance: projection teardown')

  // Writes still on the wire. A slider drag fires one write per pointer move;
  // adopting each acceptance as it lands would repaint an older value under
  // the thumb, so the accepted document is adopted once the last write settles.
  let inflight = 0
  let live = true
  // Writes waiting out the coalescing window below: the panel is already
  // showing them, so adopting the durable document now would repaint an older
  // value under the thumb.
  const pending = new Map<keyof AppearanceSettings, AppearanceSettings[keyof AppearanceSettings]>()
  let timer: ReturnType<typeof setTimeout> | null = null
  ctx.effect(() => () => { live = false }, 'idealize-appearance: settled writes stop projecting after dispose')
  const adoptSettings = (): void => {
    if (inflight > 0 || pending.size > 0 || !live) return
    const value = scope.getSnapshot().value
    if (value === undefined) return
    store.update((draft) => { draft.settings = structuredClone(value) })
    project(value)
  }
  ctx.effect(() => scope.subscribe(adoptSettings), 'idealize-appearance: settings scope adoption')
  adoptSettings()

  const adoptTheme = (snapshot: ThemeSnapshot): void => {
    const before = store.getSnapshot().scheme
    store.update((draft) => {
      draft.mode = snapshot.preference
      draft.scheme = snapshot.active.colorScheme
    })
    // Gradient seeds follow the painted palette; the token layer already carries both sides.
    if (snapshot.active.colorScheme !== before) laySheet(current(), snapshot.active.colorScheme)
  }
  ctx.on('theme/change', adoptTheme)
  adoptTheme(ctx.theme.getTheme())

  // ── fonts ─────────────────────────────────────────────────────────────
  let fontsRequested = false
  const loadFonts = (): void => {
    if (fontsRequested) return
    fontsRequested = true
    const settle = (inventory: { families: string[]; monospaced: string[] }): void => {
      store.update((draft) => {
        draft.fonts = inventory.families
        draft.monospaced = inventory.monospaced
      })
    }
    if (typeof fetch !== 'function') {
      settle({ families: [], monospaced: [] })
      return
    }
    fetch(FONTS_ROUTE)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(`fonts: ${response.status}`))))
      .then((body: unknown) => { settle(inventoryOf(body)) })
      .catch(() => { settle({ families: [], monospaced: [] }) })
  }

  // ── writes ────────────────────────────────────────────────────────────
  // The local mirror and the token projection run on every call, so a drag
  // repaints at pointer rate. The durable write does not: a range input fires
  // an event per pointer move, and one `scope.set` round trip each made the
  // panel stutter and the thumb lag the pointer (JJ, 11 Sep 2026: "sliders are
  // a little glitchy"). Writes coalesce per field over this window and go out
  // together once the pointer rests.
  const COALESCE_MS = 120
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (pending.size === 0) return
    const batch = [...pending]
    pending.clear()
    for (const [field, value] of batch) {
      inflight += 1
      void scope.set(field, value).finally(() => {
        inflight -= 1
        if (inflight === 0 && pending.size === 0) adoptSettings()
      })
    }
  }
  ctx.effect(() => () => { flush() }, 'idealize-appearance: the last coalesced write goes out on dispose')
  const write = <K extends keyof AppearanceSettings>(field: K, value: AppearanceSettings[K]): void => {
    // Optimistic local mirror; the scope round-trip settles the durable value.
    const next = { ...current(), [field]: value }
    store.update((draft) => { draft.settings = next })
    project(next)
    pending.set(field, value)
    if (timer === null) timer = setTimeout(flush, COALESCE_MS)
  }
  const setMode = (mode: ModeId): void => { ctx.theme.setTheme(mode) }
  const setOpen = (open: boolean): void => {
    store.update((draft) => { draft.open = open })
    if (open) loadFonts()
  }
  const forceScheme = (id: PresetId, groundHex: string): void => {
    // A custom ground fixes the scheme; otherwise a single-scheme preset brings its own.
    const forced = resolveAppearance(id, groundHex, current().action.colorHex).forcedScheme
    if (forced !== undefined) setMode(forced)
  }
  // The Theme tab's Reset returns the whole app to the theme's own colours:
  // every surface's text colour and background go with the preset, ground
  // and action colour (JJ, 15 Sep 2026: a reset that left the panels' light
  // colours under the dark theme was "obviously not resetting properly").
  // Typography is not a colour and stays.
  const resetTheme = (): void => {
    write('preset', APPEARANCE_DEFAULTS.preset)
    write('uiFont', APPEARANCE_DEFAULTS.uiFont)
    write('uiSize', APPEARANCE_DEFAULTS.uiSize)
    write('groundHex', APPEARANCE_DEFAULTS.groundHex)
    write('action', { ...EMPTY_ACTION })
    const surfaces = { ...current().surfaces }
    for (const id of SURFACES) surfaces[id] = clearSurfaceColours(surfaces[id])
    write('surfaces', surfaces)
    setMode('system')
  }
  // A colour edit binds the surface's colours to the scheme on screen, so
  // the person sees exactly what they are choosing over; a surface whose
  // colours are gone forgets its scheme.
  const stampScheme = (surface: SurfaceAppearance, touchedColour: boolean): SurfaceAppearance => {
    if (!surfaceColoured(surface)) return { ...surface, scheme: '' }
    return touchedColour ? { ...surface, scheme: store.getSnapshot().scheme } : surface
  }

  const face = (): AppearancePanelInjected => ({
    hooks: { appearance: store },
    close: () => { setOpen(false) },
    setSection: (section: SectionId) => { store.update((draft) => { draft.section = section }) },
    setMode,
    choosePreset: (id: PresetId) => {
      write('preset', id)
      forceScheme(id, current().groundHex)
    },
    setGround: (hex: string) => {
      write('groundHex', hex)
      forceScheme(current().preset, hex)
    },
    setAction: (patch: Partial<ActionAppearance>) => { write('action', { ...current().action, ...patch }) },
    setUiFont: (family: string) => { write('uiFont', family) },
    setUiSize: (size: number) => { write('uiSize', size) },
    setSurface: (id: SurfaceId, patch: Partial<SurfaceAppearance>) => {
      const touchedColour = SURFACE_COLOUR_FIELDS.some(field => field in patch)
      write('surfaces', { ...current().surfaces, [id]: stampScheme({ ...current().surfaces[id], ...patch }, touchedColour) })
    },
    setScalars: (patch: Partial<PanelScalars>) => {
      for (const [field, value] of Object.entries(patch) as [keyof PanelScalars, number][]) write(field, value)
    },
    setTerminal: (patch: Partial<TerminalAppearanceSettings>) => {
      write('terminal', { ...current().terminal, ...patch })
    },
    resetSection: (section: SectionId) => {
      if (section === 'theme') {
        resetTheme()
        return
      }
      if (section === 'terminal') {
        // The theme *choice* survives a reset (V0's rule); the values layered over it go.
        write('terminal', { ...TERMINAL_DEFAULTS, theme: current().terminal.theme })
        return
      }
      write('surfaces', { ...current().surfaces, [section]: { ...EMPTY_SURFACE } })
      if (section === 'chat') {
        write('chatInputOpacity', APPEARANCE_DEFAULTS.chatInputOpacity)
        write('chatShadowOpacity', APPEARANCE_DEFAULTS.chatShadowOpacity)
        write('chatMargin', APPEARANCE_DEFAULTS.chatMargin)
        write('docMargin', APPEARANCE_DEFAULTS.docMargin)
      }
    },
  })

  const service: AppearanceService = {
    open: () => { setOpen(true) },
    close: () => { setOpen(false) },
    toggle: () => { setOpen(!store.getSnapshot().open) },
    isOpen: () => store.getSnapshot().open,
    Component: AppearancePanel,
    face,
    store,
    terminalPaint: () => resolveTerminalPaint(current().terminal),
  }
  ctx.provide('appearance', service)

  // V0's Appearance toggle: ⌘⌥A on macOS, Ctrl+Alt+A elsewhere.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!event.altKey || !(event.metaKey || event.ctrlKey) || event.code !== 'KeyA') return
    event.preventDefault()
    service.toggle()
  }
  ctx.effect(() => {
    window.addEventListener('keydown', onKeydown)
    return () => { window.removeEventListener('keydown', onKeydown) }
  }, 'idealize-appearance: ⌘⌥A toggle')
}
