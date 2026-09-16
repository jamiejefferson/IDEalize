/** Host half: schema defaults, the index bootstrap, the settings registration and the font route. */
import { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_DEFAULTS, AppearanceSettingsSchema, actionCustomised, EMPTY_ACTION, EMPTY_SURFACE, fontStack,
  surfaceCustomised, uiScale, type AppearanceSettings,
} from '../src/appearance-settings.ts'
import { BOOT_STYLE_ID, injectBootAppearance } from '../src/boot-appearance.ts'
import { apply } from '../src/index.ts'

/** The durable document arrives untyped; the schema fills and validates it. */
const parse = (input: unknown): AppearanceSettings => AppearanceSettingsSchema(input as AppearanceSettings)

describe('appearance schema', () => {
  it('fills every field with its default', () => {
    expect(parse({})).toEqual(APPEARANCE_DEFAULTS)
  })

  it('rejects an unknown preset, an out-of-range size and a bad surface weight', () => {
    expect(() => parse({ preset: 'neon' })).toThrow()
    expect(() => parse({ uiSize: 40 })).toThrow()
    expect(() => parse({ surfaces: { chat: { fontWeight: 12 } } })).toThrow()
    expect(() => parse({ chatInputOpacity: 0.1 })).toThrow()
  })

  it('fills a partial surface and keeps the others at inherit', () => {
    const parsed = parse({ surfaces: { chat: { fontSize: 18 } } })
    expect(parsed.surfaces.chat).toEqual({ ...EMPTY_SURFACE, fontSize: 18 })
    expect(parsed.surfaces.doc).toEqual(EMPTY_SURFACE)
    expect(surfaceCustomised(parsed.surfaces.chat)).toBe(true)
    expect(surfaceCustomised(parsed.surfaces.doc)).toBe(false)
    expect(actionCustomised(EMPTY_ACTION)).toBe(false)
    expect(actionCustomised({ ...EMPTY_ACTION, opacity: 0.5 })).toBe(true)
  })

  it('scales by uiSize / 13 (V0 AppSettings.ui) and quotes a family over the platform stack', () => {
    expect(uiScale(13)).toBe(1)
    expect(uiScale(15)).toBeCloseTo(1.154, 3)
    expect(uiScale(10)).toBeCloseTo(0.769, 3)
    expect(fontStack('')).toMatch(/^-apple-system/)
    expect(fontStack(' Avenir Next ')).toMatch(/^"Avenir Next", -apple-system/)
  })
})

describe('injectBootAppearance', () => {
  const html = '<html><body class="x"><div id="root"></div></body></html>'

  it('emits an empty style at the defaults', () => {
    expect(injectBootAppearance(html)).toContain(`<body class="x"><style id="${BOOT_STYLE_ID}"></style>`)
  })

  it('carries a non-default font and size, stripping a tag opener', () => {
    const out = injectBootAppearance(html, { ...APPEARANCE_DEFAULTS, uiFont: 'Georgia</style>', uiSize: 15 })
    expect(out).toContain('body{--dsw-font-family:"Georgia/style>", -apple-system')
    expect(out).toContain('#root{zoom:1.154}')
  })

  it('appends to a body-less fragment', () => {
    expect(injectBootAppearance('<p>x</p>')).toMatch(/^<p>x<\/p><style/)
  })
})

/** A recording ServerResponse stand-in. */
function fakeResponse() {
  const out = { status: 0, body: '' }
  const res = {
    writeHead: (status: number) => { out.status = status; return res },
    end: (body: string) => { out.body = body },
  }
  return { out, res: res as unknown as ServerResponse }
}

describe('host apply', () => {
  it('registers the settings namespace, taps the index and serves the font list to loopback', { timeout: 30_000 }, async () => {
    const ctx = new Context()
    const register = vi.fn()
    const taps: ((html: string) => string)[] = []
    const routes: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
    ctx.provide('settings', {
      register,
      get: () => ({ ...APPEARANCE_DEFAULTS, uiSize: 16 }),
    } as never)
    ctx.provide('webServer', {
      tapIndex: (tap: (html: string) => string) => { taps.push(tap); return () => { taps.length = 0 } },
      register: (route: typeof routes[number]) => { routes.push(route); return () => { routes.length = 0 } },
    } as never)
    await ctx.plugin({ apply }).await()
    expect(register).toHaveBeenCalledWith('idealize-appearance', AppearanceSettingsSchema)
    expect(taps).toHaveLength(1)
    expect(taps[0]?.('<body></body>')).toContain('#root{zoom:1.231}')
    expect(routes.map(route => route.path)).toEqual(['/idealize/appearance/fonts'])
    const route = routes[0]
    if (route === undefined) throw new Error('route missing')
    const refused = fakeResponse()
    await route.handler({ headers: { host: 'evil.example' } } as IncomingMessage, refused.res)
    expect(refused.out.status).toBe(403)
    const hostless = fakeResponse()
    await route.handler({ headers: {} } as IncomingMessage, hostless.res)
    expect(hostless.out.status).toBe(403)
    const served = fakeResponse()
    await route.handler({ headers: { host: '127.0.0.1:3180' } } as IncomingMessage, served.res)
    expect(served.out.status).toBe(200)
    const body = JSON.parse(served.out.body) as { families: string[]; monospaced: string[] }
    expect(Array.isArray(body.families)).toBe(true)
    expect(Array.isArray(body.monospaced)).toBe(true)
  })

  it('falls back to the defaults without a settings service or a stored section', async () => {
    for (const settings of [undefined, { register: () => {}, get: () => undefined }]) {
      const ctx = new Context()
      const taps: ((html: string) => string)[] = []
      if (settings !== undefined) ctx.provide('settings', settings as never)
      ctx.provide('webServer', {
        tapIndex: (tap: (html: string) => string) => { taps.push(tap); return () => {} },
        register: () => () => {},
      } as never)
      await ctx.plugin({ apply }).await()
      expect(taps[0]?.('<body></body>')).toBe(`<body><style id="${BOOT_STYLE_ID}"></style></body>`)
    }
  })
})
