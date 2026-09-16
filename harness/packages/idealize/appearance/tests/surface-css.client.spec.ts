/** The per-surface stylesheet, the action tokens and the chat panel rules as pure functions. */
import { describe, expect, it } from 'vitest'
import { clearSurfaceColours, EMPTY_ACTION, EMPTY_SURFACE, surfaceScheme } from '../src/appearance-settings.ts'
import { contrast, parseHex, UI_CONTRAST } from '../src/colour.ts'
import { deriveTokens, presetPalette } from '../src/presets.ts'
import {
  actionAccent, actionTokens, appearanceStylesheet, panelScalarsCss, COMPOSER_ATTRIBUTE, gradientCss, seedStops,
  SURFACE_EXEMPT_ATTRIBUTE, surfaceCss,
} from '../src/surface-css.ts'

const defaults = { ground: '#F5F5F6', surface: '#FFFFFF', tokens: deriveTokens(presetPalette('idealize', 'light')), scheme: 'light' as const }
const darkDefaults = { ground: '#2A2F35', surface: '#343A41', tokens: deriveTokens(presetPalette('idealize', 'dark')), scheme: 'dark' as const }

const exempt = `[${SURFACE_EXEMPT_ATTRIBUTE}], [${SURFACE_EXEMPT_ATTRIBUTE}] *`

describe('gradientCss', () => {
  it('sorts stops, folds opacity in and maps V0 angles to CSS', () => {
    const stops = [{ colorHex: '#FFFFFF', location: 1 }, { colorHex: '#000000', location: 0 }]
    expect(gradientCss(stops, 'linear', 0, 0.5, '#888888')).toBe('linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, rgba(255, 255, 255, 0.5) 100%)')
    expect(gradientCss(stops, 'radial', 45, 1, '#888888')).toMatch(/^radial-gradient\(circle at center, #000000 0%, #FFFFFF 100%\)$/)
    expect(gradientCss(stops, 'angular', 30, 1, '#888888')).toMatch(/^conic-gradient\(from 30deg at center/)
  })

  it('falls back for empty or unparsable stops', () => {
    expect(gradientCss([], 'linear', 90, 1, '#112233')).toBe('linear-gradient(180deg, #112233 0%, #112233 100%)')
    expect(gradientCss([{ colorHex: 'nope', location: 0.5 }], 'linear', 90, 1, 'bad')).toContain('#888888 50%')
    expect(seedStops('#000000', '#FFFFFF')).toEqual([{ colorHex: '#000000', location: 0 }, { colorHex: '#FFFFFF', location: 1 }])
  })
})

describe('surfaceCss', () => {
  it('is empty for an untouched surface', () => {
    expect(surfaceCss('chat', EMPTY_SURFACE, defaults)).toBe('')
  })

  it('writes typography onto the doubled surface selector', () => {
    const css = surfaceCss('files', {
      ...EMPTY_SURFACE, fontName: 'Avenir', fontSize: 15, fontWeight: 6, tracking: 0.5, lineSpacing: 4, textColorHex: '#102030',
    }, defaults)
    const root = '[data-idealize-surface="files"][data-idealize-surface]'
    expect(css).toContain(`${root} { font-family: "Avenir", -apple-system`)
    expect(css).toContain('zoom: 1.25')
    expect(css).toContain('font-weight: 600')
    expect(css).toContain('letter-spacing: 0.5px')
    expect(css).toContain('--dsw-alias-label-primary: #102030')
    expect(css).toContain('--dsw-alias-label-secondary: rgba(16, 32, 48, 0.55)')
    expect(css).toContain(`${root} :not(code, pre, kbd, samp, code *, pre *, ${exempt}) { font-family: inherit; }`)
    expect(css).toContain(`${root} :not(${exempt}) { font-weight: inherit; }`)
    expect(css).toContain(`${root} :is(p, li, blockquote, td, dd):not(${exempt}) { line-height: calc(1.45em + 4px); }`)
  })

  it('hands an exempt subtree its typography and ink back', () => {
    // The appearance panel sits inside the drawer it edits: the surface's font,
    // zoom, weight, tracking and ink stop at the exempt root.
    const css = surfaceCss('files', {
      ...EMPTY_SURFACE, fontName: 'Zapfino', fontSize: 15, fontWeight: 1, tracking: 2, textColorHex: '#FF0000', scheme: 'light',
    }, defaults)
    const rule = css.split('\n').find(line => line.startsWith(`[data-idealize-surface="files"][data-idealize-surface] [${SURFACE_EXEMPT_ATTRIBUTE}] {`))
    expect(rule).toContain('font-family: var(--dsw-font-family)')
    expect(rule).toContain('zoom: 0.8')
    expect(rule).toContain('font-weight: normal')
    expect(rule).toContain('letter-spacing: normal')
    expect(rule).toContain(`--dsw-alias-label-primary: ${defaults.tokens['--dsw-alias-label-primary']}`)
    expect(rule).toContain(`--dsw-alias-label-secondary: ${defaults.tokens['--dsw-alias-label-secondary']}`)
    expect(rule).toContain('color: var(--dsw-alias-label-primary)')
    // A background alone leaves nothing to undo, so no exempt rule is written.
    expect(surfaceCss('files', { ...EMPTY_SURFACE, bgMode: 'solid' }, defaults)).not.toContain(SURFACE_EXEMPT_ATTRIBUTE)
    // A layer without the ink tokens is a broken resolver, named loudly.
    expect(() => surfaceCss('files', { ...EMPTY_SURFACE, textColorHex: '#FF0000' }, { ...defaults, tokens: {} })).toThrow(/carries no --dsw-alias-label-primary/)
  })

  it('adds line spacing over each surface\'s real leading, leaves headings alone, and covers bubble text', () => {
    const chat = surfaceCss('chat', { ...EMPTY_SURFACE, lineSpacing: 4 }, defaults)
    // Chat body ships at 16/28, so the slider starts from 1.75em, not 1.45em.
    expect(chat).toContain(`:is(p, li, blockquote, td, dd):not(${exempt}) { line-height: calc(1.75em + 4px); }`)
    // The user bubble's MessageText inherits its 16/24 leading; the hook rule reaches it.
    expect(chat).toContain(`[data-message-text]:not(${exempt}) { line-height: calc(1.5em + 4px); }`)
    // Headings keep their own design leading.
    expect(chat).not.toMatch(/h[1-6]/)
  })

  it('paints a solid or gradient background and clears the ground tokens', () => {
    const solid = surfaceCss('sessions', { ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: '#FF0000', bgOpacity: 0.5, scheme: 'light' }, defaults)
    expect(solid).toContain('background: rgba(255, 0, 0, 0.5)')
    expect(solid).toContain('--dsw-alias-bg-base: transparent')
    expect(surfaceCss('sessions', { ...EMPTY_SURFACE, bgMode: 'solid' }, defaults)).toContain('background: #F5F5F6')
    expect(surfaceCss('sessions', { ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: 'bad' }, { ...defaults, ground: 'bad', surface: 'bad' })).toBe('')
    const gradient = surfaceCss('doc', { ...EMPTY_SURFACE, bgMode: 'gradient', bgGradientType: 'radial' }, defaults)
    expect(gradient).toContain('background: radial-gradient(circle at center, #F5F5F6 0%, #FFFFFF 100%)')
    const own = surfaceCss('doc', { ...EMPTY_SURFACE, bgMode: 'gradient', bgGradientStops: seedStops('#000000', '#111111') }, darkDefaults)
    expect(own).toContain('#000000 0%, #111111 100%')
    const spacingOnly = surfaceCss('doc', { ...EMPTY_SURFACE, lineSpacing: 2 }, defaults)
    expect(spacingOnly).toMatch(/^\[data-idealize-surface="doc"\]\[data-idealize-surface\] :is\(/)
  })
})

describe('surface colours belong to one scheme', () => {
  it('reads the scheme off the record, or off the colours for a record without one', () => {
    expect(surfaceScheme(EMPTY_SURFACE)).toBeUndefined()
    expect(surfaceScheme({ ...EMPTY_SURFACE, fontSize: 18 })).toBeUndefined()
    expect(surfaceScheme({ ...EMPTY_SURFACE, textColorHex: '#000000', scheme: 'dark' })).toBe('dark')
    // JJ's live values on 15 Sep 2026: a light ground and black ink, chosen over the light theme.
    expect(surfaceScheme({ ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: '#FAFAFA', textColorHex: '#000000' })).toBe('light')
    expect(surfaceScheme({ ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: '#101014' })).toBe('dark')
    expect(surfaceScheme({ ...EMPTY_SURFACE, bgMode: 'gradient', bgGradientStops: [{ colorHex: 'bad', location: 0 }, { colorHex: '#F385C6', location: 1 }] })).toBe('light')
    expect(surfaceScheme({ ...EMPTY_SURFACE, textColorHex: '#000000' })).toBe('light')
    expect(surfaceScheme({ ...EMPTY_SURFACE, textColorHex: '#EEEEEE' })).toBe('dark')
    // A fill mode with nothing parsable seeds from the theme, so it belongs to the light side by default.
    expect(surfaceScheme({ ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: 'bad' })).toBe('light')
    expect(surfaceScheme({ ...EMPTY_SURFACE, bgMode: 'gradient' })).toBe('light')
  })

  it('paints the colours only in their scheme; typography paints in both', () => {
    const light = { ...EMPTY_SURFACE, fontSize: 20, textColorHex: '#000000', bgMode: 'solid' as const, bgColorHex: '#FAFAFA' }
    const inLight = surfaceCss('chat', light, defaults)
    expect(inLight).toContain('--dsw-alias-label-primary: #000000')
    expect(inLight).toContain('background: #FAFAFA')
    const inDark = surfaceCss('chat', light, darkDefaults)
    expect(inDark).toContain('zoom: 1.25')
    expect(inDark).not.toContain('label-primary')
    expect(inDark).not.toContain('background')
    expect(inDark).not.toContain('data-composer-seat')
    // The recorded scheme wins over what the colours look like.
    const stamped = { ...light, scheme: 'dark' as const }
    expect(surfaceCss('chat', stamped, darkDefaults)).toContain('background: #FAFAFA')
    expect(surfaceCss('chat', stamped, defaults)).not.toContain('background')
  })

  it('clears the colours and keeps the typography', () => {
    const cleared = clearSurfaceColours({
      ...EMPTY_SURFACE, fontName: 'Optima', fontSize: 18, textColorHex: '#000000', bgMode: 'gradient', bgOpacity: 0.5, gradientAngle: 45,
      bgGradientType: 'radial', bgGradientStops: seedStops('#000000', '#111111'), scheme: 'light',
    })
    expect(cleared).toEqual({ ...EMPTY_SURFACE, fontName: 'Optima', fontSize: 18 })
  })
})

describe('the composer seat over a surface\'s own ground', () => {
  it('blurs the transcript under the seat wherever the chat surface takes the ground token away', () => {
    for (const surface of [
      { ...EMPTY_SURFACE, bgMode: 'solid' as const, bgColorHex: '#101014' },
      { ...EMPTY_SURFACE, bgMode: 'gradient' as const, bgGradientStops: seedStops('#000000', '#111111') },
    ]) {
      // Dark grounds with no recorded scheme were chosen over the dark theme.
      const css = surfaceCss('chat', surface, darkDefaults)
      // The seat's own fade goes to --dsw-alias-bg-base, which this sheet has
      // just made transparent; the blur is what masks over a custom ground.
      expect(css).toContain('--dsw-alias-bg-base: transparent')
      // Scoped to the active phase: that is the only phase where the seat is
      // positioned, so it is the only phase where the blur is bounded by it
      // (JJ, 11 Sep 2026: on the hero screen it frosted the whole window).
      expect(css).toContain("[data-idealize-surface=\"chat\"][data-idealize-surface][data-phase='active'] [data-composer-seat]::before")
      expect(css).toContain('backdrop-filter: blur(14px)')
      // Under the seat's entries, not over them: the approval takeover is not
      // positioned, and at auto z-index the layer frosted it (JJ, 15 Sep 2026).
      expect(css).toContain('inset: 0; z-index: -1;')
      // It comes in over the same 36px band the seat's fade used.
      expect(css).toContain('mask-image: linear-gradient(180deg, transparent 0px, #000 36px)')
    }
  })

  it('leaves the seat alone on a surface that keeps the theme ground, and on every surface but chat', () => {
    // Typography alone changes no ground, so the seat's own fade still works.
    expect(surfaceCss('chat', { ...EMPTY_SURFACE, fontSize: 18 }, defaults)).not.toContain('data-composer-seat')
    // No other surface holds a composer.
    expect(surfaceCss('doc', { ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: '#101014' }, darkDefaults))
      .not.toContain('data-composer-seat')
    // A fill that does not parse paints nothing, so it takes nothing away.
    expect(surfaceCss('chat', { ...EMPTY_SURFACE, bgMode: 'solid', bgColorHex: 'bad' }, { ...defaults, ground: 'bad', surface: 'bad' }))
      .not.toContain('data-composer-seat')
  })
})

describe('actionTokens', () => {
  it('is empty when neither the action nor the accent parses', () => {
    expect(actionTokens(EMPTY_ACTION, 'bad', '#FFFFFF')).toEqual({})
  })

  it('fills buttons with the solid colour at the opacity and the soft fills at 18% / 12%', () => {
    const tokens = actionTokens({ ...EMPTY_ACTION, colorHex: '#ff74e7', opacity: 0.5 }, '#0969DA', '#F5F5F6')
    expect(tokens['--dsw-alias-button-primary-fill']).toBe('rgba(255, 116, 231, 0.5)')
    expect(tokens['--dsw-alias-interactive-bg-hover-accent']).toBe('rgba(255, 116, 231, 0.09)')
    expect(tokens['--dsw-alias-state-business-tertiary']).toBe('rgba(255, 116, 231, 0.07)')
    expect(actionTokens({ ...EMPTY_ACTION, opacity: 1 }, '#0969DA', '#F5F5F6')['--dsw-alias-button-primary-fill']).toBe('#0969DA')
  })

  it('derives brand-primary from the action colour: the chosen alpha when it reads, the deepened shade when it does not', () => {
    const pink = { r: 255, g: 0, b: 136 }
    const ground = parseHex('#F5F5F6')!
    // #FF0088 at 90% composites to 3.3:1 on the light ground: the person's alpha stands.
    const readable = actionAccent(pink, 0.9, ground)
    expect(readable).toMatchObject({ value: 'rgba(255, 0, 136, 0.9)', deepened: false })
    expect(readable.ratio).toBeGreaterThanOrEqual(UI_CONTRAST)
    // At 60% the composite reads at 2.6:1: the accent deepens along its hue and goes opaque.
    const deepened = actionAccent(pink, 0.6, ground)
    expect(deepened.deepened).toBe(true)
    expect(deepened.ratio).toBeLessThan(UI_CONTRAST)
    expect(deepened.value).toMatch(/^#[0-9A-F]{6}$/)
    expect(contrast(parseHex(deepened.value)!, ground)).toBeGreaterThanOrEqual(UI_CONTRAST)
    // A fully opaque colour that reads is emitted as plain hex.
    expect(actionAccent(parseHex('#0969DA')!, 1, ground).value).toBe('#0969DA')

    const tokens = actionTokens({ ...EMPTY_ACTION, colorHex: '#FF0088', opacity: 0.6 }, '#0969DA', '#F5F5F6', '#24292F')
    expect(tokens['--dsw-alias-brand-primary']).toBe(deepened.value)
    expect(tokens['--dsw-alias-state-business-primary']).toBe(deepened.value)
    // Every button token derives from the same colour at the same opacity.
    expect(tokens['--dsw-alias-button-primary-fill']).toBe('rgba(255, 0, 136, 0.6)')
    expect(tokens['--dsw-alias-button-info-fill']).toBe('rgba(255, 0, 136, 0.6)')
    expect(tokens['--dsw-alias-button-primary-hover']).toBe('rgba(255, 0, 136, 0.51)')
    expect(tokens['--dsw-alias-button-info-hover']).toBe('rgba(255, 0, 136, 0.51)')
    expect(tokens['--dsw-alias-button-primary-dimmed']).toBe('rgba(255, 0, 136, 0.27)')
    // The fill's text is whichever of ink and ground reads better on the composite: the ink at 5.2:1 over the ground's 2.6:1.
    expect(tokens['--dsw-alias-brand-primary-invert']).toBe('#24292F')
    expect(actionTokens({ ...EMPTY_ACTION, colorHex: '#FF0088', opacity: 0.9 }, '#0969DA', '#F5F5F6', '#24292F')['--dsw-alias-brand-primary']).toBe('rgba(255, 0, 136, 0.9)')
    // Without an ink the fill's text token is left to the layer; a bad ink is the same as none.
    expect(actionTokens({ ...EMPTY_ACTION, colorHex: '#FF0088' }, '#0969DA', '#F5F5F6')['--dsw-alias-brand-primary-invert']).toBeUndefined()
    expect(actionTokens({ ...EMPTY_ACTION, colorHex: '#FF0088' }, '#0969DA', '#F5F5F6', 'bad')['--dsw-alias-brand-primary-invert']).toBeUndefined()
  })

  it('mirrors the button fill onto the send button info pair', () => {
    const tokens = actionTokens({ ...EMPTY_ACTION, colorHex: '#FF74E7', opacity: 0.5 }, '#0969DA', '#F5F5F6')
    expect(tokens['--dsw-alias-button-info-fill']).toBe(tokens['--dsw-alias-button-primary-fill'])
    expect(tokens['--dsw-alias-button-info-hover']).toBe(tokens['--dsw-alias-button-primary-hover'])
  })

  it('deepens the accent along its hue for the business-primary text/highlight token', () => {
    // #FF74E7 fails 3:1 on near-white, so the token walks darker along its hue.
    const light = actionTokens({ ...EMPTY_ACTION, colorHex: '#FF74E7' }, '#0969DA', '#F5F5F6')
    expect(light['--dsw-alias-state-business-primary']).toMatch(/^#[0-9A-F]{6}$/)
    expect(light['--dsw-alias-state-business-primary']).not.toBe('#FF74E7')
    // On a dark ground the same pink already reads; it stays verbatim.
    const dark = actionTokens({ ...EMPTY_ACTION, colorHex: '#FF74E7' }, '#0969DA', '#17181A')
    expect(dark['--dsw-alias-state-business-primary']).toBe('#FF74E7')
    // An unparsable ground skips the token instead of guessing one.
    expect(actionTokens({ ...EMPTY_ACTION, colorHex: '#FF74E7' }, '#0969DA', 'bad')['--dsw-alias-state-business-primary']).toBeUndefined()
  })

  it('fills buttons with the gradient', () => {
    const tokens = actionTokens({ ...EMPTY_ACTION, mode: 'gradient', gradientStops: seedStops('#FF0000', '#0000FF') }, '#0969DA', '#F5F5F6')
    expect(tokens['--dsw-alias-button-primary-fill']).toBe('linear-gradient(180deg, #FF0000 0%, #0000FF 100%)')
    expect(tokens['--dsw-alias-button-info-fill']).toBe(tokens['--dsw-alias-button-primary-fill'])
    expect(actionTokens({ ...EMPTY_ACTION, mode: 'gradient' }, '#0969DA', '#F5F5F6')['--dsw-alias-button-primary-fill']).toContain('#0969DA 0%, #0969DA 100%')
  })
})

describe('panelScalarsCss + appearanceStylesheet', () => {
  it('is empty at the defaults', () => {
    expect(panelScalarsCss({ chatInputOpacity: 1, chatShadowOpacity: 0.4, chatMargin: 18, docMargin: 14 })).toBe('')
    expect(appearanceStylesheet(
      { sessions: EMPTY_SURFACE, files: EMPTY_SURFACE, chat: EMPTY_SURFACE, doc: EMPTY_SURFACE },
      { chatInputOpacity: 1, chatShadowOpacity: 0.4, chatMargin: 18, docMargin: 14 },
      defaults,
    )).toBe('')
  })

  it('feeds each margin to its own column and opacity/shadow to the composer card', () => {
    const css = panelScalarsCss({ chatInputOpacity: 0.6, chatShadowOpacity: 0.8, chatMargin: 30, docMargin: 40 })
    expect(css).toContain('--idealize-chat-pad: 30px; --idealize-chat-gap: 30px; --dsh-composer-side-clearance: 28px')
    // JJ, 10 Sep 2026: the document view takes a margin of its own.
    expect(css).toContain('[data-idealize-surface="doc"][data-idealize-surface] { --idealize-doc-pad: 40px; }')
    expect(css).toContain(`[${COMPOSER_ATTRIBUTE}][${COMPOSER_ATTRIBUTE}] { opacity: 0.6; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.36); }`)
    const sheet = appearanceStylesheet(
      { sessions: EMPTY_SURFACE, files: EMPTY_SURFACE, chat: { ...EMPTY_SURFACE, tracking: 1 }, doc: EMPTY_SURFACE },
      { chatInputOpacity: 1, chatShadowOpacity: 0.4, chatMargin: 8, docMargin: 14 },
      defaults,
    )
    // The chat root rule, its exempt rule, and the chat panel rule.
    expect(sheet.split('\n').filter(line => line !== '')).toHaveLength(3)
  })
})
