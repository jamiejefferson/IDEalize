// @vitest-environment jsdom
// The model browser: its pure data (rows from the media and chat catalogues,
// Good at labels, makers, headline prices per output, search, filters and
// sort) and the modal that renders it over the window (the list with its
// In use mark, the detail pane's facts, the example fetched on selection and
// played in place, the keyboard, and apply).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import {
  byline, chatModel, cleanName, filterModels, goodAtFor, makerName, mediaModel, money, monthYear, sortModels,
} from '../src/client/model-browser.ts'
import type { BrowserModel, MediaCandidateModel } from '../src/client/model-browser.ts'
import { ModelBrowser } from '../src/client/ModelBrowser.tsx'
// Type-only: the locale-namespace merge the translate face reads.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)

const KLING: MediaCandidateModel = {
  id: 'fal-ai/kling-video/v3/pro/text-to-video',
  name: 'Kling 3.0 Pro Text to Video',
  inputModalities: ['text'],
  description: 'Cinematic clips with sound.',
  thumbnailUrl: 'https://cdn.example/kling.jpg',
  tags: ['Stylized', 'audio'],
  licence: 'commercial',
  released: '2026-02-04',
  maker: 'kling-video',
  controls: ['length', 'seed', 'sound', 'not-a-control'],
  price: { unitPrice: 0.112, unit: 'seconds', currency: 'USD', perOutput: { amount: 0.56, output: '5 s clip' } },
}
const VEO: MediaCandidateModel = {
  id: 'fal-ai/veo3.1/image-to-video',
  name: 'Veo 3.1 Image to Video',
  inputModalities: ['text', 'image'],
  requiredInputs: ['image'],
  thumbnailUrl: 'https://cdn.example/veo.jpg',
  tags: ['lipsync'],
  // Shipped labels win over the tags, in the kind's order.
  goodAt: ['talking', 'realistic', 'not-a-label'],
  controls: ['lastFrame', 'length'],
  licence: 'research',
  released: '2026-05-20',
  maker: 'veo3.1',
  price: { unitPrice: 0.4, unit: 'seconds', currency: 'USD', perOutput: { amount: 2, output: '5 s clip' } },
}
const ODD: MediaCandidateModel = {
  id: 'acme/odd-video',
  name: 'Odd Video',
  inputModalities: ['text'],
  thumbnailUrl: 'https://cdn.example/odd.jpg',
  licence: 'commercial',
  price: { unitPrice: 0.9, unit: 'generations', currency: 'USD' },
}
const BARE: MediaCandidateModel = { id: 'acme/bare-video', name: 'Bare Video', licence: 'commercial' }

const video = (models: MediaCandidateModel[]): BrowserModel[] => models.map(model => mediaModel('fal', model, 'video', 'fal.ai', t))

afterEach(() => { cleanup() })

describe('model browser data', () => {
  it('folds a media candidate into a row with its maker, Good at labels, controls and per-clip price', () => {
    const [row] = video([KLING])
    expect(row).toMatchObject({
      value: 'fal fal-ai/kling-video/v3/pro/text-to-video',
      name: 'Kling 3.0 Pro',
      maker: 'Kuaishou',
      takes: ['text'],
      // No shipped labels: the tags earn them.
      goodAt: ['browser.goodAt.animation', 'browser.goodAt.sound'],
      controls: ['browser.control.length', 'browser.control.seed', 'browser.control.sound'],
      hasExample: true,
    })
    expect(row!.price).toMatchObject({ headline: '$0.56', sub: '$0.112 a second', comparable: true, sortValue: 0.56, from: 'fal.ai' })
    expect(row!.price.lines).toEqual([
      { label: 'Per second', value: '$0.112', figure: true },
      { label: 'Per 5 s clip', value: '$0.56', figure: true },
    ])
  })

  it('states a price it cannot turn into the column\'s unit in its own unit, and marks it not comparable', () => {
    const [odd, bare] = video([ODD, BARE])
    expect(odd!.price).toMatchObject({ headline: '$0.90', sub: 'per generation', comparable: false })
    expect(bare!.price).toEqual({ comparable: false, lines: [] })
  })

  it('names chat models by OpenRouter\'s maker prefix, and earns chat labels from abilities', () => {
    const row = chatModel('openrouter', 'OpenRouter', {
      id: 'anthropic/claude-opus-5',
      name: 'Anthropic: Claude Opus 5',
      contextWindow: 1_000_000,
      tools: true,
      reasoning: false,
      inputModalities: ['text', 'image', 'file'],
      price: { input: 5, output: 25, source: 'market' },
    }, t)
    expect(row).toMatchObject({ name: 'Claude Opus 5', maker: 'Anthropic', route: 'OpenRouter', takes: ['text', 'image', 'file'] })
    expect(row.goodAt).toEqual(['browser.goodAt.research', 'browser.goodAt.agents'])
    expect(row.controls).toEqual(['browser.control.tools'])
    // Shipped facts replace the abilities, an empty label list included.
    const labelled = chatModel('openrouter', 'OpenRouter', {
      id: 'x/y', name: 'Y', tools: true, goodAt: [], controls: ['json', 'tools'],
    }, t)
    expect(labelled.goodAt).toEqual([])
    expect(labelled.controls).toEqual(['browser.control.tools', 'browser.control.json'])
    expect(row.price).toMatchObject({ headline: '$25.00', sub: '$5.00 reading', from: 'OpenRouter' })
    expect(byline(row)).toBe('Anthropic · OpenRouter')
    // A route named after the maker reads once.
    expect(byline(chatModel('openai-codex', 'OpenAI (ChatGPT)', { id: 'gpt-5.5', name: 'gpt-5.5' }, t))).toBe('OpenAI (ChatGPT)')
  })

  it('formats small prices without rounding them away', () => {
    expect(money(0.04)).toBe('$0.04')
    expect(money(0.0125)).toBe('$0.0125')
    expect(money(0.003)).toBe('$0.003')
    expect(money(12)).toBe('$12.00')
    expect(money(1.5, 'GBP')).toBe('£1.50')
  })

  it('maps makers, names and dates as the list shows them', () => {
    expect(makerName('flux-pro', 'fal-ai/flux-pro/v1.1')).toBe('Black Forest Labs')
    expect(makerName('nano-banana-2', 'fal-ai/nano-banana-2')).toBe('Google')
    expect(makerName('some-lab', 'some-lab/model')).toBe('Some Lab')
    // Families map to makers by whole segment, a version allowed after them.
    expect(makerName('veo3.1', 'fal-ai/veo3.1')).toBe('Google')
    expect(makerName('kling-video', 'fal-ai/kling-video/v3')).toBe('Kuaishou')
    expect(makerName('samurai', 'fal-ai/samurai')).toBe('Samurai')
    // The fallback drops service suffixes and keeps known casing.
    expect(makerName('mirage-api', 'mirage-api/x')).toBe('Mirage')
    expect(makerName('mirelo-ai', 'mirelo-ai/x')).toBe('Mirelo')
    expect(makerName('ai-avatar', 'fal-ai/ai-avatar')).toBe('AI Avatar')
    expect(makerName('bernini-r', 'fal-ai/bernini-r')).toBe('Bernini-R')
    expect(makerName('veed', 'veed/avatars')).toBe('VEED')
    expect(cleanName('Seedream 4.5 Text to Image')).toBe('Seedream 4.5')
    expect(cleanName('Text to Image')).toBe('Text to Image')
    expect(monthYear('2026-02-04')).toBe('Feb 2026')
    expect(monthYear(undefined)).toBeUndefined()
    expect(goodAtFor('audio', ['SFX', 'tts'])).toEqual(['browser.goodAt.sfx', 'browser.goodAt.speech'])
  })

  it('filters by search, Takes, Good at, controls and licence together', () => {
    const rows = video([KLING, VEO, ODD])
    const base = { query: '', takes: [], goodAt: [], controls: [], clientOnly: false }
    expect(filterModels(rows, { ...base, query: 'cinematic' }).map(row => row.name)).toEqual(['Kling 3.0 Pro'])
    expect(filterModels(rows, { ...base, query: 'kuaishou' }).map(row => row.name)).toEqual(['Kling 3.0 Pro'])
    expect(filterModels(rows, { ...base, takes: ['image'] }).map(row => row.name)).toEqual(['Veo 3.1'])
    expect(filterModels(rows, { ...base, goodAt: ['browser.goodAt.talking'] }).map(row => row.name)).toEqual(['Veo 3.1'])
    expect(filterModels(rows, { ...base, controls: ['browser.control.length'] }).map(row => row.name)).toEqual(['Kling 3.0 Pro', 'Veo 3.1'])
    expect(filterModels(rows, { ...base, controls: ['browser.control.length', 'browser.control.lastFrame'] }).map(row => row.name)).toEqual(['Veo 3.1'])
    expect(filterModels(rows, { ...base, clientOnly: true }).map(row => row.name)).toEqual(['Kling 3.0 Pro', 'Odd Video'])
  })

  it('sorts cheapest first with other units next and unpriced models last, or newest, or by name', () => {
    const rows = video([BARE, ODD, VEO, KLING])
    expect(sortModels(rows, 'cheapest').map(row => row.name)).toEqual(['Kling 3.0 Pro', 'Veo 3.1', 'Odd Video', 'Bare Video'])
    expect(sortModels(rows, 'newest').map(row => row.name)).toEqual(['Veo 3.1', 'Kling 3.0 Pro', 'Bare Video', 'Odd Video'])
    expect(sortModels(rows, 'name').map(row => row.name)).toEqual(['Bare Video', 'Kling 3.0 Pro', 'Odd Video', 'Veo 3.1'])
  })
})

describe('ModelBrowser', () => {
  const mount = (overrides: Partial<Parameters<typeof ModelBrowser>[0]> = {}) => {
    const onApply = vi.fn()
    const onClose = vi.fn()
    const fetchExample = vi.fn(async (_provider: string, _model: string) => ({ url: 'https://cdn.example/clip.mp4', mediaType: 'video/mp4' }))
    const view = render(
      <ModelBrowser
        kind="video"
        spaceLabel="Motion"
        models={video([KLING, VEO, ODD, BARE])}
        current="fal fal-ai/veo3.1/image-to-video"
        sampleSource="fal.ai"
        t={t}
        onApply={onApply}
        onClose={onClose}
        fetchExample={fetchExample}
        {...overrides}
      />,
    )
    const browser = document.body.querySelector<HTMLElement>('[data-model-browser]')!
    const names = (): string[] => [...browser.querySelectorAll('[data-browser-row]')]
      .map(row => row.querySelector('span')?.firstChild?.textContent ?? '')
    return { view, browser, names, onApply, onClose, fetchExample }
  }

  it('renders over the window with the header, the price column\'s unit and the client-work switch on', () => {
    const { view, browser, names } = mount()
    // Portalled to the body, outside whatever pane opened it.
    expect(view.container.contains(browser)).toBe(false)
    expect(browser.textContent).toContain('Motion · video model')
    expect(within(browser).getByRole('heading', { name: 'Choose a model' })).toBeTruthy()
    expect(browser.textContent).toContain('Per 5 s clip')
    // Client work only starts on, so the research-licensed model is hidden.
    expect((browser.querySelector('[data-browser-client-only]') as HTMLInputElement).checked).toBe(true)
    expect(names()).toEqual(['Kling 3.0 Pro', 'Odd Video', 'Bare Video'])
    expect(browser.querySelector('[data-browser-count]')?.textContent).toBe('3 of 4 models')
    fireEvent.click(browser.querySelector('[data-browser-client-only]')!)
    expect(names()).toEqual(['Kling 3.0 Pro', 'Veo 3.1', 'Odd Video', 'Bare Video'])
    // The model in use is marked and selected, and the button keeps it.
    expect(browser.querySelector('[data-in-use]')?.getAttribute('aria-selected')).toBe('true')
    expect(within(browser).getByRole('button', { name: 'Keep Veo 3.1' })).toBeTruthy()
    // An unpriced model says so in its price lane.
    expect(browser.querySelector('[data-browser-row="fal acme/bare-video"]')?.textContent).toContain('no price yet')
  })

  it('hides the client-work switch when no model states a licence', () => {
    const { licence: _licence, ...unlicensed } = KLING
    const { browser } = mount({ models: video([unlicensed]) })
    expect(browser.querySelector('[data-browser-client-only]')).toBeNull()
  })

  it('narrows by chips and reorders by the sort', () => {
    const { browser, names } = mount()
    fireEvent.click(browser.querySelector('[data-browser-client-only]')!)
    fireEvent.click(browser.querySelector('[data-browser-takes="image"]')!)
    expect(names()).toEqual(['Veo 3.1'])
    fireEvent.click(browser.querySelector('[data-browser-takes="image"]')!)
    fireEvent.click(browser.querySelector('[data-browser-good-at="browser.goodAt.sound"]')!)
    expect(names()).toEqual(['Kling 3.0 Pro'])
    expect(browser.querySelector('[data-browser-good-at="browser.goodAt.sound"]')?.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(browser.querySelector('[data-browser-good-at="browser.goodAt.sound"]')!)
    // Only the chips some model earns are offered.
    expect(browser.querySelector('[data-browser-good-at="browser.goodAt.upscale"]')).toBeNull()
    expect(browser.querySelector('[data-browser-control="browser.control.camera"]')).toBeNull()
    fireEvent.click(browser.querySelector('[data-browser-control="browser.control.lastFrame"]')!)
    expect(names()).toEqual(['Veo 3.1'])
    fireEvent.click(browser.querySelector('[data-browser-control="browser.control.lastFrame"]')!)
    fireEvent.change(browser.querySelector('[data-browser-sort]')!, { target: { value: 'newest' } })
    expect(names()).toEqual(['Veo 3.1', 'Kling 3.0 Pro', 'Bare Video', 'Odd Video'])
  })

  it('shows the selected model\'s facts, fetches its example once, and plays it in place', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
    const { browser, fetchExample } = mount()
    fireEvent.click(browser.querySelector('[data-browser-row="fal fal-ai/kling-video/v3/pro/text-to-video"]')!)
    const detail = browser.querySelector('[data-browser-detail]') as HTMLElement
    expect(detail.textContent).toContain('Kuaishou · released Feb 2026')
    expect(detail.textContent).toContain('Cinematic clips with sound.')
    expect(detail.textContent).toContain('Animation · With sound')
    expect(detail.textContent).toContain('ControlsLength · Repeatable · Adds sound')
    expect(detail.textContent).toContain('Commercial use')
    expect(detail.textContent).toContain('Per 5 s clip$0.56')
    expect(detail.textContent).toContain('Price fromfal.ai')
    expect((detail.querySelector('[data-browser-sample] img') as HTMLImageElement).src).toBe('https://cdn.example/kling.jpg')
    await waitFor(() => { expect(detail.querySelector('[data-browser-play]')).toBeTruthy() })
    expect(fetchExample).toHaveBeenCalledWith('fal', 'fal-ai/kling-video/v3/pro/text-to-video')
    expect(detail.textContent).toContain('Example clip from fal.ai. Playing it costs nothing.')
    fireEvent.click(detail.querySelector('[data-browser-play]')!)
    expect((detail.querySelector('[data-browser-video]') as HTMLVideoElement).src).toBe('https://cdn.example/clip.mp4')
    expect(play).toHaveBeenCalled()
    play.mockRestore()
    // Back to the model and away again: the example is not fetched twice.
    fireEvent.click(browser.querySelector('[data-browser-row="fal acme/odd-video"]')!)
    fireEvent.click(browser.querySelector('[data-browser-row="fal fal-ai/kling-video/v3/pro/text-to-video"]')!)
    await waitFor(() => { expect(fetchExample).toHaveBeenCalledTimes(3) })
    expect(fetchExample.mock.calls.filter(([, id]) => id === 'fal-ai/kling-video/v3/pro/text-to-video')).toHaveLength(1)
  })

  it('plays a sound model\'s example in its waveform player', async () => {
    const tone: MediaCandidateModel = { id: 'fal-ai/stable-audio-25', name: 'Stable Audio 2.5', thumbnailUrl: 'https://cdn.example/a.jpg', tags: ['music'] }
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
    const { browser } = mount({
      kind: 'audio',
      spaceLabel: 'Sound',
      models: [mediaModel('fal', tone, 'audio', 'fal.ai', t)],
      current: 'fal fal-ai/stable-audio-25',
      fetchExample: async () => ({ url: 'https://cdn.example/track.wav', mediaType: 'audio/wav' }),
    })
    await waitFor(() => { expect(browser.querySelector('[data-browser-player]')).toBeTruthy() })
    expect((browser.querySelector('[data-browser-audio]') as HTMLAudioElement).src).toBe('https://cdn.example/track.wav')
    fireEvent.click(within(browser.querySelector('[data-browser-player]') as HTMLElement).getByRole('button', { name: 'Play example' }))
    expect(play).toHaveBeenCalled()
    expect(browser.textContent).toContain('Example track from fal.ai. Playing it costs nothing.')
    play.mockRestore()
  })

  it('applies the selection, moves it with the arrow keys, and closes on Escape', () => {
    const { browser, onApply, onClose } = mount({ current: '' })
    expect((browser.querySelector('[data-browser-apply]') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(browser, { key: 'ArrowDown' })
    fireEvent.keyDown(browser, { key: 'ArrowDown' })
    expect(browser.querySelector('[aria-selected="true"]')?.getAttribute('data-browser-row')).toBe('fal acme/odd-video')
    fireEvent.click(within(browser).getByRole('button', { name: 'Use Odd Video' }))
    expect(onApply).toHaveBeenCalledWith('fal acme/odd-video')
    fireEvent.keyDown(browser, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('offers the default model back for a chat field that has a choice', () => {
    const rows = [chatModel('anthropic', 'Anthropic', { id: 'claude', name: 'claude' }, t)]
    const { browser, onApply } = mount({ kind: 'chat', models: rows, current: 'anthropic claude', allowDefault: true })
    // A chat model shows no sample.
    expect(browser.querySelector('[data-browser-sample]')).toBeNull()
    fireEvent.click(browser.querySelector('[data-browser-default]')!)
    expect(onApply).toHaveBeenCalledWith('')
  })

  it('drops the Released lane when no model in the list states a date', () => {
    const rows = [chatModel('openai-codex', 'OpenAI (ChatGPT)', { id: 'gpt-5.5', name: 'gpt-5.5' }, t)]
    const { browser } = mount({ kind: 'chat', models: rows, current: '' })
    expect(browser.textContent).not.toContain('Released')
    // Model, Takes and Price: the lanes left take the room.
    expect(browser.querySelector('[data-browser-row]')?.children).toHaveLength(3)
    cleanup()
    expect(mount().browser.textContent).toContain('Released')
  })

  it('says it is reading while the catalogue has not arrived', () => {
    const { browser } = mount({ models: null })
    expect(browser.textContent).toContain('Reading the catalogue…')
  })
})
