// @vitest-environment jsdom
// The Time & cost pane: the totals band and the projects table over the work
// route (working time in whole minutes, cost only where prices are known, the
// plan share named), the one-line rule, and the Budget section that moved
// here from the Brains pane — the per-category table with its project scope
// and monthly budget, the per-model spend with price editing, and the
// generations table with what fal billed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en } from '../src/client/locales.ts'
import { WorkPanel } from '../src/client/WorkPanel.tsx'
// Type-only: the locale-namespace merge the translate face reads.
import type {} from '../src/client/index.ts'

const t = makeTranslate(en, commonEn)

const STATE = {
  providers: [
    { provider: 'openai-codex', displayName: 'OpenAI (ChatGPT)' },
    { provider: 'anthropic', displayName: 'Anthropic' },
    { provider: 'freetokens', displayName: 'Free tokens' },
  ],
}

const HOUR = 3600
const WORK = {
  projects: [
    { path: '/p/alpha', label: 'alpha', time: { today: 45 * 60, month: 12 * HOUR + 5 * 60, all: 40 * HOUR }, cost: { month: 3.5 }, tokens: { month: 1_200_000 } },
    { path: '/p/beta', label: 'beta', time: { today: 0, month: 30, all: 20 * 60 }, cost: { month: 0 }, tokens: { month: 500 } },
  ],
  totals: {
    time: { today: 45 * 60, month: 12 * HOUR + 6 * 60, all: 40 * HOUR + 20 * 60 },
    cost: { month: 23.5, plans: 20 },
    tokens: { month: 1_200_500 },
  },
  currency: 'USD',
  costConfigured: true,
}

const USAGE = {
  scope: '',
  projects: [{ path: '/p/alpha', label: 'alpha' }],
  month: { subscriptions: 1500, metered: 0, free: 250, total: 1750 },
  year: { subscriptions: 2_400_000, metered: 12, free: 250, total: 2_400_262 },
  monthlyTokenBudget: 0,
  // Costs the host computed from configured prices: a $20 plan (unset for
  // Anthropic) and 12 metered tokens this year that no price entry covers.
  cost: {
    currency: 'USD',
    month: { subscriptions: 20, metered: 0, free: 0, total: 20 },
    year: { subscriptions: 160, metered: 0.5, free: 0, total: 160.5 },
    unpricedTokens: { month: 0, year: 12 },
    unpricedSubscriptions: ['anthropic'],
    configured: true,
  },
  // One row per model with usage this month: a subscription row, an unpriced
  // metered row, a metered row OpenRouter priced from its directory, a free row.
  models: [
    { provider: 'openai-codex', model: 'gpt-5.5', category: 'subscriptions', total: 1500 },
    { provider: 'anthropic', model: 'claude', category: 'metered', total: 900 },
    { provider: 'openrouter', model: 'a/b', category: 'metered', total: 400, cost: 0.25, price: { input: 1, output: 2, cacheRead: 1, cacheWrite: 1, source: 'market' } },
    { provider: 'freetokens', model: 'auto', category: 'free', total: 250 },
  ],
  openRouterPrices: { fetchedAt: '2026-09-08T07:24:39.767Z', models: 276 },
  // One row per endpoint that generated this month: a billed one, one fal has
  // not billed yet, one fal reported that this app did not make itself, and one
  // whose media type the copy has no word of its own for.
  generations: {
    rows: [
      { provider: 'fal', model: 'fal-ai/flux/dev', mediaType: 'image/png', count: 6, billed: { quantity: 6, unit: 'image', cost: 0.52, currency: 'USD' } },
      { provider: 'fal', model: 'fal-ai/kling/video', mediaType: 'video/mp4', count: 2 },
      { provider: 'fal', model: 'fal-ai/whisper', count: 0, billed: { quantity: 1, unit: 'second', cost: 0.1, currency: 'USD' } },
      { provider: 'fal', model: 'fal-ai/any-llm', mediaType: 'text/markdown', count: 1 },
    ],
    billed: { month: { USD: 0.62 }, year: { USD: 1.4 } } as { month: Record<string, number>; year: Record<string, number> } | undefined,
    currency: 'USD' as string | null,
  },
  falUsage: { fetchedAt: '2026-09-08T07:24:39.767Z' } as { fetchedAt: string | null; error?: string } | null,
}

/** An instant as the panel prints it. */
const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
/** The cost strings the panel is expected to render, formatted exactly as the component formats them. */
const usd = (value: number): string => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(value)

type Call = { url: string; init?: RequestInit }
let calls: Call[]
/** The payloads a test mounts over; `install` resets them to the shared fixtures. */
let workPayload: typeof WORK | null
let usagePayload: typeof USAGE

/** The JSON a POST carried. */
const sent = (call: Call): unknown => JSON.parse(call.init?.body as string)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function install(): void {
  calls = []
  workPayload = WORK
  usagePayload = USAGE
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, ...init === undefined ? {} : { init } })
    if (url === '/idealize/models/work') return Promise.resolve(workPayload === null ? json({ error: 'down' }, 500) : json(workPayload))
    if (url.startsWith('/idealize/models/state')) return Promise.resolve(json(STATE))
    if (url.startsWith('/idealize/models/usage')) return Promise.resolve(json(usagePayload))
    return Promise.resolve(json({ ok: true }))
  }))
}

async function mount() {
  const view = render(<WorkPanel t={t} />)
  await waitFor(() => { expect(view.getByRole('table', { name: 'Budget breakdown' })).toBeTruthy() })
  return view
}

const posts = (path: string): Call[] => calls.filter(call => call.url === path && call.init?.method === 'POST')

beforeEach(install)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkPanel', () => {
  it('states the month’s working time and cost, the rule, and one row per project', async () => {
    const view = await mount()
    await waitFor(() => { expect(view.container.querySelector('[data-work-month]')?.textContent).toBe('12h 06m') })
    expect(view.container.querySelector('[data-work-today]')?.textContent).toBe('Today 45m')
    expect(view.container.querySelector('[data-work-cost]')?.textContent).toBe(usd(23.5))
    // The plan share is named, because no project row carries it.
    expect(view.getByText(`The total includes ${usd(20)} in subscription plans, which belong to no one project.`)).toBeTruthy()
    expect(view.getByText('Working time counts the minutes a project’s chats spend answering, plus pauses under five minutes between turns.')).toBeTruthy()
    const table = view.getByRole('table', { name: 'Projects' })
    expect([...table.querySelectorAll('[data-work-project]')].map(row => row.getAttribute('data-work-project'))).toEqual(['/p/alpha', '/p/beta'])
    const alpha = table.querySelector('[data-work-project="/p/alpha"]') as HTMLElement
    expect(alpha.querySelector('[data-work-project-month]')?.textContent).toBe('12h 05m')
    expect(alpha.querySelector('[data-work-project-all]')?.textContent).toBe('40h 00m')
    expect(alpha.querySelector('[data-work-project-cost]')?.textContent).toBe(usd(3.5))
    // Under a minute rounds to nothing rather than showing seconds.
    const beta = table.querySelector('[data-work-project="/p/beta"]') as HTMLElement
    expect(beta.querySelector('[data-work-project-month]')?.textContent).toBe('1m')
    expect(beta.querySelector('[data-work-project-all]')?.textContent).toBe('20m')
    expect(view.container.querySelector('[data-work-no-prices]')).toBeNull()
    expect(view.container.querySelector('[data-work-failed]')).toBeNull()
  })

  it('shows a dash for every cost, under a hint, while no price or plan cost is known', async () => {
    workPayload = { ...WORK, costConfigured: false, totals: { ...WORK.totals, cost: { month: 0, plans: 0 } } }
    const view = await mount()
    await waitFor(() => { expect(view.container.querySelector('[data-work-cost]')?.textContent).toBe('—') })
    expect(view.container.querySelector('[data-work-project-cost]')?.textContent).toBe('—')
    expect(view.container.querySelector('[data-work-no-prices]')?.textContent)
      .toBe('Costs appear once you set a model’s price below or a subscription cost in settings.')
    expect(view.queryByText(/subscription plans/)).toBeNull()
  })

  it('says when there is no project yet, and when the route could not be read', async () => {
    workPayload = { ...WORK, projects: [] }
    const empty = await mount()
    await waitFor(() => { expect(empty.getByText('No project has working time yet.')).toBeTruthy() })
    cleanup()

    workPayload = null
    const down = await mount()
    await waitFor(() => { expect(down.container.querySelector('[data-work-failed]')?.textContent).toBe('Working time could not be read.') })
    expect(down.container.querySelector('[data-work-month]')?.textContent).toBe('—')
  })

  it('shows the budget table per scope and saves a monthly budget', async () => {
    const view = await mount()
    await waitFor(() => { expect(view.getAllByText('1.5k').length).toBeGreaterThan(0) })
    expect(view.getAllByText('2.4M')).toHaveLength(2)
    const table = view.getByRole('table', { name: 'Budget breakdown' })
    expect(table.querySelectorAll('[role="row"]')).toHaveLength(5)
    // Each cell leads with the configured-price cost over the token count.
    expect(within(table).getAllByText(usd(20))).toHaveLength(2) // month: Subscriptions and Total
    expect(within(table).getByText(usd(160.5))).toBeTruthy()
    expect(within(table).getByText(usd(0.5))).toBeTruthy()
    // What the shown costs leave out is called out, not silently zeroed.
    expect(view.getByText('No monthly cost set for Anthropic; those subscriptions are not counted in costs.')).toBeTruthy()
    expect(view.getByText('12 tokens this year have no price set and are not counted in costs.')).toBeTruthy()
    fireEvent.change(view.getByRole('combobox', { name: 'View' }), { target: { value: '/p/alpha' } })
    await waitFor(() => {
      expect(calls.some(call => call.url === `/idealize/models/usage?scope=${encodeURIComponent('/p/alpha')}`)).toBe(true)
    })
    fireEvent.click(view.getByRole('button', { name: 'Set a budget' }))
    fireEvent.change(view.getByRole('textbox', { name: 'Monthly budget' }), { target: { value: '500000' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    await waitFor(() => { expect(posts('/idealize/models/budget')).toHaveLength(1) })
    expect(sent(posts('/idealize/models/budget')[0]!)).toEqual({ monthlyTokenBudget: 500000 })
  })

  it('shows token-only cells and a pricing hint while no price or plan cost is configured', async () => {
    usagePayload = {
      ...USAGE,
      cost: {
        currency: 'USD',
        month: { subscriptions: 0, metered: 0, free: 0, total: 0 },
        year: { subscriptions: 0, metered: 0, free: 0, total: 0 },
        unpricedTokens: { month: 0, year: 12 },
        unpricedSubscriptions: ['openai-codex'],
        configured: false,
      },
    }
    const view = await mount()
    await waitFor(() => { expect(view.getAllByText('1.5k').length).toBeGreaterThan(0) })
    const table = view.getByRole('table', { name: 'Budget breakdown' })
    // Never a made-up figure: no cost renders until the user supplies prices.
    expect(table.querySelectorAll('[data-budget-cost]')).toHaveLength(0)
    expect(view.container.querySelector('[data-budget-no-prices]')?.textContent)
      .toBe('Costs appear once you set a model’s price below or a subscription cost in settings.')
    expect(view.container.querySelector('[data-budget-unpriced-subs]')).toBeNull()
    expect(view.container.querySelector('[data-budget-unpriced-tokens]')).toBeNull()
  })

  it('lists each model used this month with its cost, and saves a typed price for an unpriced one', async () => {
    // JJ, 8 Sep 2026: "Cost of the models has not been included in the budget section."
    const view = await mount()
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    const table = view.getByRole('table', { name: 'Models this month' })
    expect([...table.querySelectorAll('[data-spend-model]')].map(row => row.getAttribute('data-spend-model')))
      .toEqual(['openai-codex gpt-5.5', 'anthropic claude', 'openrouter a/b', 'freetokens auto'])
    // A priced metered row shows its cost; an unpriced one a dash and the action; the others their category.
    expect(table.querySelector('[data-spend-cost="openrouter a/b"]')?.textContent).toBe(usd(0.25))
    expect(table.querySelector('[data-spend-unpriced="anthropic claude"]')).toBeTruthy()
    expect(within(table.querySelector('[data-spend-model="openai-codex gpt-5.5"]') as HTMLElement).getByText('Subscription')).toBeTruthy()
    expect(within(table.querySelector('[data-spend-model="freetokens auto"]') as HTMLElement).getByText('Free')).toBeTruthy()
    // Every route is named by the pane's one rule: the directory's name, else the id with a capital.
    expect(within(table.querySelector('[data-spend-model="anthropic claude"]') as HTMLElement).getByText('Anthropic')).toBeTruthy()
    expect(within(table.querySelector('[data-spend-model="openrouter a/b"]') as HTMLElement).getByText('Openrouter')).toBeTruthy()
    // The total sums the priced rows and counts the unpriced ones.
    expect(table.querySelector('[data-spend-total-cost]')?.textContent).toBe(usd(0.25))
    expect(table.querySelector('[data-spend-unpriced-count]')?.textContent).toBe('1 unpriced')
    // The OpenRouter-priced row names its source in the editor.
    fireEvent.click(within(table).getByRole('button', { name: 'Edit price' }))
    expect(table.querySelector('[data-spend-price-source="market"]')?.textContent)
      .toBe(`Price published by OpenRouter, read ${when('2026-09-08T07:24:39.767Z')}. A price you type replaces it.`)
    expect((view.getByRole('textbox', { name: 'a/b Input per million' }) as HTMLInputElement).value).toBe('1')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    // Set a price on the unpriced row: input and output typed, cache prices left to the input price.
    fireEvent.click(within(table).getByRole('button', { name: 'Set price' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Input per million' }), { target: { value: '3' } })
    fireEvent.change(view.getByRole('textbox', { name: 'claude Output per million' }), { target: { value: '15' } })
    fireEvent.click(view.getByRole('button', { name: 'Cache prices' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Cache read per million' }), { target: { value: '0.3' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    await waitFor(() => { expect(posts('/idealize/models/prices')).toHaveLength(1) })
    expect(sent(posts('/idealize/models/prices')[0]!)).toEqual({
      provider: 'anthropic',
      model: 'claude',
      price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3 },
    })
    expect(view.getByRole('status').textContent).toBe('Price saved.')
    // The usage re-reads so the row's cost appears.
    expect(calls.filter(call => call.url.startsWith('/idealize/models/usage')).length).toBeGreaterThan(1)
  })

  it('lists each endpoint that generated this month with what fal billed for it', async () => {
    // JJ, 8 Sep 2026: "what about Fal?"
    const view = await mount()
    await waitFor(() => { expect(view.getByRole('table', { name: 'Generations this month' })).toBeTruthy() })
    const table = view.getByRole('table', { name: 'Generations this month' })
    expect([...table.querySelectorAll('[data-generation-row]')].map(row => row.getAttribute('data-generation-row')))
      .toEqual(['fal-ai/flux/dev', 'fal-ai/kling/video', 'fal-ai/whisper', 'fal-ai/any-llm'])
    // What it made: the count, with the media kind beside the service's name.
    expect(within(table.querySelector('[data-generation-row="fal-ai/flux/dev"]') as HTMLElement).getByText('Fal · images')).toBeTruthy()
    expect(within(table.querySelector('[data-generation-row="fal-ai/kling/video"]') as HTMLElement).getByText('Fal · video')).toBeTruthy()
    // An endpoint only fal reported carries no media type, so it names the service alone.
    expect(within(table.querySelector('[data-generation-row="fal-ai/whisper"]') as HTMLElement).getByText('Fal')).toBeTruthy()
    // A media type outside images, video and sound reads as files.
    expect(within(table.querySelector('[data-generation-row="fal-ai/any-llm"]') as HTMLElement).getByText('Fal · files')).toBeTruthy()
    // The billed cost in fal's own currency, with the units fal charged for.
    expect(table.querySelector('[data-generation-cost="fal-ai/flux/dev"]')?.textContent).toBe(usd(0.52))
    expect(within(table.querySelector('[data-generation-row="fal-ai/flux/dev"]') as HTMLElement).getByText('6 image')).toBeTruthy()
    // A row fal has counted but not billed says so rather than showing a zero.
    expect(table.querySelector('[data-generation-unbilled="fal-ai/kling/video"]')?.textContent).toBe('not billed yet')
    expect(table.querySelector('[data-generations-total-cost]')?.textContent).toBe(usd(0.62))
    expect(view.container.querySelector('[data-generations-connect]')).toBeNull()
    expect(view.container.querySelector('[data-generations-error]')).toBeNull()
  })

  it('asks for a fal key, says when nothing was generated, and passes fal’s refusal through', async () => {
    usagePayload = { ...USAGE, generations: { ...USAGE.generations, rows: [], billed: undefined, currency: null }, falUsage: null }
    const bare = await mount()
    await waitFor(() => { expect(bare.getByRole('table', { name: 'Generations this month' })).toBeTruthy() })
    expect(bare.getByText('No generations this month.')).toBeTruthy()
    expect(bare.container.querySelector('[data-generations-connect]')?.textContent)
      .toBe('Connect fal to see what generations cost.')
    // Nothing billed leaves the total a dash, never a made-up zero.
    expect(bare.container.querySelector('[data-generations-total-cost]')).toBeNull()
    cleanup()

    usagePayload = { ...USAGE, falUsage: { fetchedAt: null, error: 'fal.ai answered 403: Access denied' } }
    const refused = await mount()
    await waitFor(() => { expect(refused.container.querySelector('[data-generations-error]')).toBeTruthy() })
    expect(refused.container.querySelector('[data-generations-error]')?.textContent)
      .toBe('fal did not report its billing. fal.ai answered 403: Access denied')
    expect(refused.container.querySelector('[data-generations-connect]')).toBeNull()
  })

  it('names the shipped catalogue as a price’s source in the editor', async () => {
    usagePayload = {
      ...USAGE,
      models: [
        { provider: 'anthropic', model: 'claude', category: 'metered', total: 900, cost: 0.9, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, source: 'catalogue' } },
      ],
    }
    const view = await mount()
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    fireEvent.click(within(view.getByRole('table', { name: 'Models this month' })).getByRole('button', { name: 'Edit price' }))
    expect(view.container.querySelector('[data-spend-price-source="catalogue"]')?.textContent)
      .toBe('Price from the model catalogue the app ships. A price you type replaces it.')
  })

  it('refuses to save a price with a figure missing, rather than reading the gap as free', async () => {
    const view = await mount()
    await waitFor(() => { expect(view.getByRole('table', { name: 'Models this month' })).toBeTruthy() })
    fireEvent.click(within(view.getByRole('table', { name: 'Models this month' })).getByRole('button', { name: 'Set price' }))
    fireEvent.change(view.getByRole('textbox', { name: 'claude Input per million' }), { target: { value: '3' } })
    await act(async () => { fireEvent.click(view.getByRole('button', { name: 'Save' })) })
    expect(posts('/idealize/models/prices')).toHaveLength(0)
    expect(view.getByRole('status').textContent).toBe('Enter an input and an output price.')
  })
})
