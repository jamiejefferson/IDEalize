// @vitest-environment jsdom
/** Client apply: the appearance service, the ui-theme override layer, the
 * surface stylesheet, the DOM projection, and the settings round-trips. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsScopeBinder } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as theme from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '@deepseek-ai/dsh-client-ui-theme/src/theme-settings.ts'
import { apply, applyAppearanceDom, inject, openAppearancePanel, SHEET_ID } from '../src/client/index.ts'
import type { AppearanceService } from '../src/client/index.ts'
import { APPEARANCE_DEFAULTS, APPEARANCE_SETTINGS_NAMESPACE, AppearanceSettingsSchema, EMPTY_SURFACE } from '../src/appearance-settings.ts'
import { deriveTokens, preset } from '../src/presets.ts'

usePinnedBrowserLanguages('en-US')

afterEach(() => {
  document.getElementById('root')?.remove()
  document.getElementById(SHEET_ID)?.remove()
  vi.unstubAllGlobals()
})

async function bench(initial: Partial<Record<string, unknown>> = {}) {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const values: Record<string, Record<string, unknown>> = {
    [THEME_SETTINGS_NAMESPACE]: { preference: 'system' },
    [APPEARANCE_SETTINGS_NAMESPACE]: structuredClone({ ...APPEARANCE_DEFAULTS, ...initial }),
  }
  const schemas: Record<string, unknown> = {
    [THEME_SETTINGS_NAMESPACE]: ThemeSettingsSchema.toJSON(),
    [APPEARANCE_SETTINGS_NAMESPACE]: AppearanceSettingsSchema.toJSON(),
  }
  let revision = 0
  const namespace = (ns: string) => ({
    // A copy: the binder freezes the section it adopts, and the fake keeps writing the original.
    ns, schema: schemas[ns], value: structuredClone(values[ns]), applies: 'live' as const, secrets: [], revision,
  })
  const describe = vi.fn(() => Promise.resolve({
    rpcId: 'describe' as never,
    result: { ok: true as const, value: { writable: true, hasDocument: true, namespaces: Object.keys(values).map(namespace) } },
  }))
  const mutate = vi.fn((request: { ns: string; ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[] }) => {
    const section = values[request.ns]
    if (section === undefined) throw new Error(`unknown namespace ${request.ns}`)
    for (const op of request.ops) {
      const [field] = op.path
      if (field === undefined) continue
      if (op.op === 'unset') Reflect.deleteProperty(section, field)
      else section[field] = op.value
    }
    revision += 1
    return Promise.resolve({ rpcId: 'mutate' as never, result: { ok: true as const, value: namespace(request.ns) } })
  })
  ctx.provide('connection', { api: { settings: { describe, mutate } }, isLoopback: true } as never)
  new TestRemote(ctx)
  await ctx.plugin(SettingsScopeBinder).await()
  await ctx.plugin(theme).await()
  const fiber = ctx.plugin({ inject, apply })
  await fiber.await()
  await new Promise(resolve => setTimeout(resolve, 0))
  return {
    ctx, fiber, mutate, values,
    appearance: ctx.get('appearance') as AppearanceService,
    theme: ctx.get('theme') as ThemeRuntime,
    slots,
  }
}

const rootZoom = (): string => document.getElementById('root')?.style.zoom ?? 'missing'
const sheet = (): string => document.getElementById(SHEET_ID)?.textContent ?? ''

describe('idealize-appearance apply', () => {
  it('declares its services', () => {
    expect(inject).toEqual(['locale', 'settingsScope', 'theme'])
  })

  it('the DOM applier tolerates a missing mount', () => {
    expect(() => { applyAppearanceDom(document, 1.5) }).not.toThrow()
  })

  it('⌘⌥A toggles the panel; other chords do not', async () => {
    const b = await bench()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', altKey: true, metaKey: true }))
    expect(b.appearance.isOpen()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', altKey: true, ctrlKey: true }))
    expect(b.appearance.isOpen()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', metaKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', altKey: true, metaKey: true }))
    expect(b.appearance.isOpen()).toBe(false)
    b.appearance.open()
    b.appearance.face().close()
    expect(b.appearance.isOpen()).toBe(false)
  })

  it('provides the service; open/close/toggle drive the store and opening asks for the fonts once', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ families: ['Avenir', 7] }))))
    vi.stubGlobal('fetch', fetchMock)
    const b = await bench()
    expect(b.appearance.isOpen()).toBe(false)
    openAppearancePanel(b.ctx)
    expect(b.appearance.isOpen()).toBe(true)
    b.appearance.toggle()
    expect(b.appearance.isOpen()).toBe(false)
    b.appearance.open()
    b.appearance.close()
    expect(b.appearance.isOpen()).toBe(false)
    expect(b.appearance.Component).toBeTypeOf('function')
    expect(b.appearance.face().hooks.appearance).toBe(b.appearance.store)
    // No slot registration of its own: the rail seats the panel in the drawer.
    expect(b.slots.entries('shell.overlay')).toEqual([])
    await vi.waitFor(() => { expect(b.appearance.store.getSnapshot().fonts).toEqual(['Avenir']) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/idealize/appearance/fonts')
  })

  it('settles an empty font list when the route fails, answers oddly, or fetch is missing', async () => {
    for (const response of [new Response('no', { status: 500 }), new Response('null'), new Response('{"families":"x"}')]) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response)))
      const failing = await bench()
      failing.appearance.open()
      await vi.waitFor(() => { expect(failing.appearance.store.getSnapshot().fonts).toEqual([]) })
      await failing.fiber.dispose()
    }
    vi.stubGlobal('fetch', undefined)
    const bare = await bench()
    bare.appearance.open()
    expect(bare.appearance.store.getSnapshot().fonts).toEqual([])
  })

  it('lays the IDEalize layer, no stylesheet and no zoom at the defaults', async () => {
    const b = await bench()
    // The layer equals the skin sheet's own values, so the first paint and the panel agree.
    expect(b.theme.getTheme().active.tokens).toEqual(deriveTokens(preset('idealize').light))
    b.theme.setTheme('dark')
    expect(b.theme.getTheme().active.tokens).toEqual(deriveTokens(preset('idealize').dark))
    expect(rootZoom()).toBe('')
    expect(document.getElementById(SHEET_ID)).toBeNull()
  })

  it('choosing Ink lays the layer on both schemes and forces dark', async () => {
    const b = await bench()
    b.appearance.face().choosePreset('ink')
    const snapshot = b.theme.getTheme()
    expect(snapshot.preference).toBe('dark')
    expect(snapshot.active.tokens['--dsw-alias-bg-base']).toBe('#17181A')
    b.theme.setTheme('light')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#F7F5F0')
    await vi.waitFor(() => {
      expect(b.values[APPEARANCE_SETTINGS_NAMESPACE]?.preset).toBe('ink')
      expect(b.values[THEME_SETTINGS_NAMESPACE]?.preference).toBe('light')
    })
  })

  it('a custom ground forces its scheme; font, size, action colour and Return-to-send project', async () => {
    const b = await bench()
    const face = b.appearance.face()
    face.setGround('#101820')
    expect(b.theme.getTheme().preference).toBe('dark')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#101820')
    face.setUiFont('Georgia')
    expect(b.theme.getTheme().active.tokens['--dsw-font-family']).toMatch(/^"Georgia"/)
    face.setUiSize(15)
    expect(rootZoom()).toBe('1.154')
    face.setAction({ colorHex: '#FF74E7' })
    expect(b.theme.getTheme().active.tokens['--dsw-alias-button-primary-fill']).toBe('#FF74E7')
    // On the dark custom ground the pink reads, so borders and icons take it verbatim; the fill's text is the ground's ink pick.
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary']).toBe('#FF74E7')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-brand-primary-invert']).toBe('#101820')
    face.setAction({ opacity: 0.5 })
    expect(b.theme.getTheme().active.tokens['--dsw-alias-button-primary-fill']).toBe('rgba(255, 116, 231, 0.5)')
    face.setAction({ mode: 'gradient' })
    expect(b.theme.getTheme().active.tokens['--dsw-alias-button-primary-fill']).toMatch(/^linear-gradient\(180deg/)
    await vi.waitFor(() => {
      expect(b.values[APPEARANCE_SETTINGS_NAMESPACE]?.uiFont).toBe('Georgia')
    })
  })

  it('surface and chat writes land in one stylesheet that re-seeds on a scheme flip', async () => {
    const b = await bench()
    const face = b.appearance.face()
    face.setSurface('files', { tracking: 0.5 })
    expect(sheet()).toContain('[data-idealize-surface="files"][data-idealize-surface] { letter-spacing: 0.5px; }')
    face.setScalars({ chatMargin: 30, chatInputOpacity: 0.6 })
    expect(sheet()).toContain('--idealize-chat-pad: 30px')
    expect(sheet()).toContain('opacity: 0.6')
    face.setSurface('doc', { bgMode: 'gradient' })
    expect(sheet()).toContain('linear-gradient(180deg, #FFFFFF 0%, #FFFFFF 100%)')
    // A colour edit binds the surface to the scheme on screen, so the dark
    // theme keeps its own ground until colours are chosen over it.
    await vi.waitFor(() => {
      const stored = b.values[APPEARANCE_SETTINGS_NAMESPACE] as { surfaces: Record<string, { scheme: string }> }
      expect(stored.surfaces.doc?.scheme).toBe('light')
      expect(stored.surfaces.files?.scheme).toBe('')
    })
    b.theme.setTheme('dark')
    expect(sheet()).not.toContain('linear-gradient')
    face.setSurface('doc', { bgGradientStops: [{ colorHex: '#000000', location: 0 }, { colorHex: '#333333', location: 1 }] })
    expect(sheet()).toContain('linear-gradient(180deg, #000000 0%, #333333 100%)')
    b.theme.setTheme('light')
    expect(sheet()).not.toContain('linear-gradient')
    face.setSection('doc')
    expect(b.appearance.store.getSnapshot().section).toBe('doc')
    face.resetSection('doc')
    face.resetSection('files')
    face.resetSection('chat')
    expect(document.getElementById(SHEET_ID)).toBeNull()
    await vi.waitFor(() => {
      const stored = b.values[APPEARANCE_SETTINGS_NAMESPACE] as { surfaces: Record<string, unknown>; chatMargin: number }
      expect(stored.surfaces.files).toEqual(EMPTY_SURFACE)
      expect(stored.chatMargin).toBe(18)
    })
  })

  it('terminal settings write, resolve to paint, and reset keeping the theme choice', async () => {
    const b = await bench()
    const face = b.appearance.face()
    expect(b.appearance.terminalPaint().background).toBe('#F7F5F0')
    face.setTerminal({ theme: 'ink', fontSize: 18, margin: 12 })
    const paint = b.appearance.terminalPaint()
    expect(paint.background).toBe('#17181A')
    expect(paint.fontSize).toBe(18)
    expect(paint.margin).toBe(12)
    await vi.waitFor(() => {
      expect((b.values[APPEARANCE_SETTINGS_NAMESPACE]?.terminal as { theme: string }).theme).toBe('ink')
    })
    face.resetSection('terminal')
    expect(b.appearance.terminalPaint().fontSize).toBe(14)
    // The theme *choice* survives the reset (V0's rule).
    expect(b.appearance.terminalPaint().background).toBe('#17181A')
  })

  it('colours recorded before the scheme field paint only over the theme they were chosen on', async () => {
    // JJ's 15 Sep 2026 document: light chat colours with no scheme, then Dark.
    const chat = { ...EMPTY_SURFACE, fontSize: 20, textColorHex: '#000000', bgMode: 'solid', bgColorHex: '#FAFAFA' }
    const b = await bench({ surfaces: { ...APPEARANCE_DEFAULTS.surfaces, chat } })
    b.theme.setTheme('light')
    expect(sheet()).toContain('background: #FAFAFA')
    b.theme.setTheme('dark')
    expect(sheet()).toContain('zoom: 1.25')
    expect(sheet()).not.toContain('#FAFAFA')
    expect(sheet()).not.toContain('#000000')
  })

  it('resetting the Theme tab clears every panel\'s colours and keeps its typography', async () => {
    const chat = { ...EMPTY_SURFACE, fontName: 'Optima', textColorHex: '#000000', bgMode: 'solid', bgColorHex: '#FAFAFA', scheme: 'light' }
    const b = await bench({ surfaces: { ...APPEARANCE_DEFAULTS.surfaces, chat } })
    b.appearance.face().resetSection('theme')
    expect(b.appearance.store.getSnapshot().settings.surfaces.chat).toEqual({ ...EMPTY_SURFACE, fontName: 'Optima' })
    expect(sheet()).not.toContain('#FAFAFA')
    await vi.waitFor(() => {
      const stored = b.values[APPEARANCE_SETTINGS_NAMESPACE] as { surfaces: Record<string, unknown> }
      expect(stored.surfaces.chat).toEqual({ ...EMPTY_SURFACE, fontName: 'Optima' })
    })
  })

  it('resetting the Theme tab returns the layer to IDEalize and clears the zoom and the mode', async () => {
    const b = await bench({ preset: 'linen', uiSize: 16, uiFont: 'Menlo' })
    expect(b.theme.getTheme().active.tokens['--dsw-alias-bg-base']).toBe('#F7F5F0')
    expect(rootZoom()).toBe('1.231')
    b.theme.setTheme('light')
    b.appearance.face().resetSection('theme')
    expect(b.theme.getTheme().active.tokens).toEqual(deriveTokens(preset('idealize').light))
    expect(b.theme.getTheme().preference).toBe('system')
    expect(rootZoom()).toBe('')
    expect(b.appearance.store.getSnapshot().settings).toEqual(APPEARANCE_DEFAULTS)
  })

  it('coalesces a drag into one durable write and adopts once it settles', async () => {
    const b = await bench()
    const ns = APPEARANCE_SETTINGS_NAMESPACE
    // A drag produces an event per pointer move. Each one repaints locally at
    // once; the durable writes coalesce over the window and go out as one
    // carrying the value the pointer rested on.
    const gates: (() => void)[] = []
    let revision = 10
    const slow = (request: { ns: string; ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[] }) => {
      const section = b.values[request.ns]!
      for (const op of request.ops) if (op.path[0] !== undefined && op.op === 'set') section[op.path[0]] = op.value
      const value = structuredClone(section)
      revision += 1
      const answer = { rpcId: 'mutate' as never, result: { ok: true as const, value: { ns: request.ns, schema: AppearanceSettingsSchema, value, applies: 'live' as const, secrets: [], revision } } }
      return new Promise<typeof answer>((resolve) => { gates.push(() => { resolve(answer) }) })
    }
    b.mutate.mockImplementation(slow)
    const before = rootZoom()
    b.appearance.face().setUiSize(14)
    b.appearance.face().setUiSize(15)
    b.appearance.face().setUiSize(16)
    // The panel is already at the last value, with nothing on the wire yet.
    expect(b.appearance.store.getSnapshot().settings.uiSize).toBe(16)
    expect(rootZoom()).not.toBe(before)
    expect(b.mutate).toHaveBeenCalledTimes(0)
    // One write leaves once the pointer rests, carrying 16 and not 14 or 15.
    // (The zoom is not re-read here: benches in this file share one document
    // and an earlier one's projection outlives its test.)
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(b.mutate).toHaveBeenCalledTimes(1)
    expect(gates).toHaveLength(1)
    gates[0]!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(b.appearance.store.getSnapshot().settings.uiSize).toBe(16)
    expect(b.values[ns]!.uiSize).toBe(16)
  })

  it('adopts a Host-side section and tears the projection down on dispose', async () => {
    const b = await bench({ surfaces: { ...APPEARANCE_DEFAULTS.surfaces, chat: { ...EMPTY_SURFACE, fontSize: 20 } } })
    expect(sheet()).toContain('zoom: 1.25')
    b.appearance.face().choosePreset('og')
    expect(b.theme.getTheme().active.tokens['--dsw-alias-bg-layer-1']).toBe('#FFFFFF')
    expect(b.appearance.store.getSnapshot().mode).toBe('system')
    await b.fiber.dispose()
    expect(b.theme.getTheme().active.tokens).toEqual({})
    expect(document.getElementById(SHEET_ID)).toBeNull()
  })
})
