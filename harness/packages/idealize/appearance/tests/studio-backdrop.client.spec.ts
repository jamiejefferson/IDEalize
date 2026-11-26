/**
 * The Studio's backdrops: JJ's three tuned presets, the adjustments layered
 * over one, and the CSS the Studio view draws, which has to match the tuning
 * page's expressions.
 */
import { describe, expect, it } from 'vitest'
import {
  APPEARANCE_DEFAULTS, AppearanceSettingsSchema, resolveStudioPaint, STUDIO_BACKDROP_CHOICES, STUDIO_DEFAULTS, studioCustomised,
  type AppearanceSettings,
} from '../src/appearance-settings.ts'
import {
  BACKDROP_COLOURS, BACKDROP_RANGES, backdropInks, backdropPaint, STUDIO_BACKDROPS, studioBackdrop, tweakedBackdrop, withBackdropTweak,
  type Backdrop, type BackdropNumberKey,
} from '../src/studio-backdrop.ts'

const GREY = studioBackdrop('grey').backdrop

describe('the tuned backdrops', () => {
  it('are Grey, Blue and White as JJ settled them, on the tuning page and then in the app (26 Nov 2026)', () => {
    expect(STUDIO_BACKDROPS.map(option => option.name)).toEqual(['Grey', 'Blue', 'White'])
    expect(STUDIO_BACKDROP_CHOICES).toEqual(['none', 'grey', 'blue', 'white'])
    expect(GREY).toMatchObject({ wall: '#242424', lightColour: '#F2F2F2', light: 21, lightY: 9, floorColour: '#000000', ink: '#FFFFFF', size: 11, panelFill: 61 })
    expect(studioBackdrop('blue').backdrop).toMatchObject({ wall: '#024364', lightColour: '#429A84', vignette: 88, mottle: 51, seamSoft: 116, panel: '#FFFFFF', panelBlur: 0 })
    expect(studioBackdrop('white').backdrop).toMatchObject({ wall: '#D9D9D9', light: 100, lightX: 60, floorLight: 72, ink: '#292929', accent: '#B04594', panelEdge: 32 })
    // An id that is not listed reads as the first backdrop.
    expect(studioBackdrop('sepia').id).toBe('grey')
  })

  it('sit inside the dial ranges, on each dial\'s step', () => {
    for (const { id, backdrop } of STUDIO_BACKDROPS) {
      for (const [key, range] of Object.entries(BACKDROP_RANGES) as [BackdropNumberKey, { min: number; max: number; step: number }][]) {
        const value = backdrop[key]
        expect(value, `${id}.${key}`).toBeGreaterThanOrEqual(range.min)
        expect(value, `${id}.${key}`).toBeLessThanOrEqual(range.max)
        const steps = (value - range.min) / range.step
        expect(Math.abs(steps - Math.round(steps)), `${id}.${key} on its step`).toBeLessThan(1e-6)
      }
      for (const key of BACKDROP_COLOURS) expect(backdrop[key], `${id}.${key}`).toMatch(/^#[0-9A-F]{6}$/)
    }
    // No text shadow and no corner radius: JJ ruled both out on 26 Nov 2026.
    expect(Object.keys(GREY).filter(key => /shadow|radius/i.test(key))).toEqual([])
  })
})

describe('adjustments', () => {
  it('layer over the backdrop, with an unparsable colour falling back to its own', () => {
    const drawn = tweakedBackdrop(GREY, { light: 60, floor: false, wall: '#102030', ink: 'nope' })
    expect(drawn).toMatchObject({ light: 60, floor: false, wall: '#102030', ink: '#FFFFFF', vignette: 52 })
    expect(tweakedBackdrop(GREY, undefined)).toEqual(GREY)
  })

  it('store only what differs, per backdrop', () => {
    const one = withBackdropTweak({}, 'grey', 'mottle', 60, GREY.mottle)
    expect(one).toEqual({ grey: { mottle: 60 } })
    const two = withBackdropTweak(one, 'blue', 'wall', '#102030', '#024364')
    expect(two).toEqual({ grey: { mottle: 60 }, blue: { wall: '#102030' } })
    // Back to the backdrop's own value, or an emptied colour, removes the adjustment and then the backdrop.
    expect(withBackdropTweak(two, 'grey', 'mottle', 34, GREY.mottle)).toEqual({ blue: { wall: '#102030' } })
    expect(withBackdropTweak(two, 'blue', 'wall', '', '#024364')).toEqual({ grey: { mottle: 60 } })
  })
})

describe('backdropPaint', () => {
  it('writes the tuning page\'s expressions for Grey', () => {
    const paint = backdropPaint(GREY)
    expect(paint.wall).toBe('#242424')
    expect(paint.light).toBe(
      'radial-gradient(ellipse 64% 48% at 50% 9%, color-mix(in srgb, #F2F2F2 21%, transparent) 0%, color-mix(in srgb, #F2F2F2 16.8%, transparent) 24%, '
      + 'color-mix(in srgb, #F2F2F2 9.66%, transparent) 50%, color-mix(in srgb, #F2F2F2 3.36%, transparent) 76%, transparent 100%)',
    )
    expect(paint.vignette).toBe('radial-gradient(farthest-corner at 50% 9%, transparent 35%, color-mix(in srgb, #000 52%, transparent) 100%)')
    expect(paint.floor).toEqual({
      seam: 'linear-gradient(to bottom, transparent calc(80% - 30%), color-mix(in srgb, #000 16%, transparent) 80%, color-mix(in srgb, #000 16%, transparent) 100%)',
      top: '80%',
      colour: '#000000',
      image: 'radial-gradient(ellipse 75% 130% at 50% 0%, color-mix(in srgb, #F2F2F2 31%, transparent) 0%, color-mix(in srgb, #F2F2F2 12.4%, transparent) 55%, transparent 100%)',
      mask: 'linear-gradient(to bottom, transparent 0, #000 36px)',
      streaks: 0.16,
    })
    expect(paint.mottle).toEqual({ opacity: 0.34, size: 1080 })
    expect(paint.grain).toEqual({ opacity: 0.1, size: 300 })
    expect(paint.variables).toMatchObject({
      '--idealize-backdrop-ink': '#FFFFFF',
      '--idealize-backdrop-ink-2': '#C7C7C7',
      '--idealize-backdrop-accent': '#0B4FA8',
      '--idealize-backdrop-size': '11px',
      '--idealize-backdrop-weight': '450',
      '--idealize-backdrop-leading': '1.5',
      '--idealize-backdrop-tracking': '0em',
      '--idealize-backdrop-panel': 'color-mix(in srgb, #FFFFFF 61%, transparent)',
      '--idealize-backdrop-panel-blur': '6px',
      '--idealize-backdrop-panel-edge': 'color-mix(in srgb, #FFFFFF 38%, transparent)',
      '--idealize-backdrop-wash': 'color-mix(in srgb, #FFFFFF 10%, transparent)',
    })
  })

  it('leaves out each layer a dial switches off, and thins the text with its opacity', () => {
    const bare: Backdrop = { ...GREY, floor: false, mottle: 0, grain: 0, inkOpacity: 70 }
    const paint = backdropPaint(bare, '"Optima", serif')
    expect(paint.floor).toBeUndefined()
    expect(paint.mottle).toBeUndefined()
    expect(paint.grain).toBeUndefined()
    expect(paint.variables['--idealize-backdrop-ink']).toBe('color-mix(in srgb, #FFFFFF 70%, transparent)')
    expect(paint.variables['--idealize-backdrop-font']).toBe('"Optima", serif')
    // A floor without texture draws no streaks.
    expect(backdropPaint({ ...GREY, floorTexture: 0 }).floor?.streaks).toBeUndefined()
  })
})

describe('the Studio settings section', () => {
  const parse = (input: unknown): AppearanceSettings => AppearanceSettingsSchema(input as AppearanceSettings)

  it('defaults to White, untouched, and a document written before the section reads the same', () => {
    expect(STUDIO_DEFAULTS).toEqual({ backdrop: 'white', fontName: '', tweaks: {} })
    expect(APPEARANCE_DEFAULTS.studio).toBe(STUDIO_DEFAULTS)
    expect(parse({}).studio).toEqual(STUDIO_DEFAULTS)
    expect(parse({ studio: { backdrop: 'white', tweaks: { white: { light: 40, wall: '#FFFFFF', floor: false } } } }).studio)
      .toEqual({ backdrop: 'white', fontName: '', tweaks: { white: { light: 40, wall: '#FFFFFF', floor: false } } })
    // A dial outside its range is refused.
    expect(() => parse({ studio: { tweaks: { grey: { light: 400 } } } })).toThrow()
  })

  it('counts the font and the adjustments as customised, never the backdrop choice', () => {
    expect(studioCustomised(STUDIO_DEFAULTS)).toBe(false)
    expect(studioCustomised({ ...STUDIO_DEFAULTS, backdrop: 'grey' })).toBe(false)
    expect(studioCustomised({ ...STUDIO_DEFAULTS, fontName: 'Optima' })).toBe(true)
    expect(studioCustomised({ ...STUDIO_DEFAULTS, tweaks: { grey: { light: 40 } } })).toBe(true)
  })

  it('resolves to the chosen backdrop with its adjustments, or to nothing on None', () => {
    expect(resolveStudioPaint()?.wall).toBe('#D9D9D9')
    expect(resolveStudioPaint({ backdrop: 'none', fontName: 'Optima', tweaks: {} })).toBeUndefined()
    const paint = resolveStudioPaint({ backdrop: 'blue', fontName: ' Optima ', tweaks: { blue: { wall: '#102030' }, grey: { wall: '#FF0000' } } })
    expect(paint?.wall).toBe('#102030')
    expect(paint?.variables['--idealize-backdrop-font']).toMatch(/^"Optima", /)
  })
})

describe('backdropInks', () => {
  const lum = (hex: string): number => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
  const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
  const over = (ground: string, fill: string, share: number): string => `#${[1, 3, 5].map((at) => {
    const value = Math.round(parseInt(ground.slice(at, at + 2), 16) * (1 - share) + parseInt(fill.slice(at, at + 2), 16) * share)
    return value.toString(16).padStart(2, '0')
  }).join('')}`

  it('keeps JJ\'s colours where they read on the bare backdrop', () => {
    expect(backdropInks(GREY).title).toBe('#FFFFFF')
    expect(backdropInks(studioBackdrop('blue').backdrop).title).toBe('#F4FAFC')
    expect(backdropInks(studioBackdrop('white').backdrop).title).toBe('#292929')
  })

  it('moves panel text until it reads on the panel over the wall and over the floor, on every backdrop', () => {
    for (const { id, backdrop } of STUDIO_BACKDROPS) {
      const inks = backdropInks(backdrop)
      for (const ground of [backdrop.wall, backdrop.floorColour]) {
        const panel = over(ground, backdrop.panel, backdrop.panelFill / 100)
        for (const ink of [inks.panel, inks.panel2, inks.panelAccent, inks.panelError]) {
          expect(ratio(ink, panel), `${id} ${ink} on ${panel}`).toBeGreaterThanOrEqual(4.9)
        }
      }
      // A raised control (a chosen segment, a tile's button) carries the same text.
      expect(ratio(inks.panel, inks.raised), `${id} raised`).toBeGreaterThanOrEqual(4.9)
      expect(ratio(inks.foot, backdrop.floorColour), `${id} foot`).toBeGreaterThanOrEqual(4.4)
    }
  })

  it('no longer draws near-white text on the Grey and Blue panels, which are more than half white', () => {
    expect(lum(backdropInks(GREY).panel)).toBeLessThan(0.1)
    expect(lum(backdropInks(studioBackdrop('blue').backdrop).panel)).toBeLessThan(0.1)
  })

  it('publishes the checked colours for the view', () => {
    const { variables } = backdropPaint(GREY)
    expect(variables['--idealize-backdrop-panel-ink']).toBe(backdropInks(GREY).panel)
    expect(variables['--idealize-backdrop-panel-raised']).toBe('#FFFFFF')
    expect(variables['--idealize-backdrop-title-ink']).toBe('#FFFFFF')
  })
})
