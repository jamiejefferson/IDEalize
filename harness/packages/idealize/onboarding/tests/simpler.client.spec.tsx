// @vitest-environment jsdom
// The welcome sheet over its real controller and the real route client on a
// mock fetch: it shows only for a seed that is done and has not seen the
// three-part set-up, never beside the wizard; each row reads Ready or asks for
// what is missing; and either button records it as seen.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createOnboardingApi } from '../src/client/api.ts'
import type { AgentsState } from '../src/client/api.ts'
import { createOnboardingFlow } from '../src/client/flow.ts'
import { en } from '../src/client/locales.ts'
import { createSimplerSheet, simplerSheetDue } from '../src/client/simpler.ts'
import { SimplerSheet } from '../src/client/SimplerSheet.tsx'
import type { SimplerSheetProps } from '../src/client/SimplerSheet.tsx'
import type { OnboardingSeedLike } from '../src/client/steps.ts'

afterEach(cleanup)

const t = (key: string): string => en[key as keyof typeof en] ?? key

/** Flush pending route promises and their effects. */
const flush = async (): Promise<void> => {
  await act(async () => {})
  await act(async () => {})
}

interface RecordedCall {
  path: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

interface FetchTable {
  agents: AgentsState
  launches?: unknown
  services?: unknown
  modelsState?: unknown
  posts?: Record<string, { status: number; body: unknown }>
}

function mockFetch(table: FetchTable) {
  const calls: RecordedCall[] = []
  const gets: Record<string, () => unknown> = {
    '/idealize/onboarding/agents': () => table.agents,
    '/idealize/terminal/launches': () => table.launches,
    '/idealize/brains/services': () => table.services,
    '/idealize/models/state': () => table.modelsState,
  }
  const serve = async (path: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<unknown> => {
    const method = init?.method ?? 'GET'
    calls.push({
      path,
      method,
      headers: init?.headers ?? {},
      ...init?.body === undefined ? {} : { body: JSON.parse(init.body) as unknown },
    })
    if (method === 'GET') {
      const payload = gets[path]?.()
      if (payload === undefined) return { ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) }
      return { ok: true, status: 200, json: () => Promise.resolve(payload) }
    }
    const post = table.posts?.[path] ?? { status: 200, body: { ok: true } }
    return { ok: post.status === 200, status: post.status, json: () => Promise.resolve(post.body) }
  }
  return { fetchFn: serve as unknown as typeof fetch, calls }
}

/** The Terminal's launch choices with chosen apps installed and a chosen default command. */
function launches(installed: readonly string[], command = 'claude --dangerously-skip-permissions') {
  const catalog = [
    { id: 'claude-code', label: 'Claude Code', command: 'claude --dangerously-skip-permissions' },
    { id: 'codex', label: 'Codex CLI', command: 'codex' },
    { id: 'gemini', label: 'Gemini CLI', command: 'gemini' },
    { id: 'antigravity', label: 'Antigravity CLI', command: 'agy' },
    { id: 'kimi', label: 'Kimi CLI', command: 'kimi' },
  ].map(entry => ({ ...entry, installed: installed.includes(entry.id) }))
  return { default: command, byActivity: {}, catalog }
}

const UPDATED: OnboardingSeedLike = { done: true, steps: { agents: 'done' } }
const NOTHING: AgentsState = { claudeCode: { installed: false }, openrouter: { connected: false }, fal: { connected: false } }
const EVERYTHING: AgentsState = { claudeCode: { installed: true }, openrouter: { connected: true }, fal: { connected: true } }

function mount(seed: OnboardingSeedLike | undefined, table: FetchTable) {
  const markSeen = vi.fn()
  const releaseHold = vi.fn()
  const sheet = createSimplerSheet({ markSeen, releaseHold })
  const opened = sheet.open(seed)
  const { fetchFn, calls } = mockFetch(table)
  const props = {
    useSheet: bindSnapshotSelector(sheet.view),
    t,
    api: createOnboardingApi(fetchFn),
    close: sheet.close,
  } as unknown as SimplerSheetProps
  render(<SimplerSheet {...props} />)
  return { sheet, opened, markSeen, releaseHold, calls }
}

const one = (selector: string): HTMLElement => {
  const found = document.querySelector(selector)
  if (found === null) throw new Error(`nothing matches ${selector}`)
  return found as HTMLElement
}
const text = (selector: string): string | undefined => document.querySelector(selector)?.textContent ?? undefined
const status = (row: string): string | null => one(`[data-simpler-row="${row}"] [data-simpler-status]`).getAttribute('data-simpler-status')
const posts = (calls: RecordedCall[]): [string, unknown][] => calls.filter(call => call.method === 'POST').map(call => [call.path, call.body])

describe('when the welcome sheet shows', () => {
  const seeds: [string, OnboardingSeedLike | undefined, boolean][] = [
    ['no stored section', undefined, false],
    ['a wizard in progress', { steps: { agents: 'done' } }, false],
    ['a fresh install that finished the wizard', { done: true, simplerSeen: true }, false],
    ['an update: done, and stored before simplerSeen existed', { done: true }, true],
    ['an update whose stored field reads false', { done: true, simplerSeen: false }, true],
    ['a new section that has seen the set-up but is not done', { simplerSeen: true }, false],
  ]

  it.each(seeds)('%s', (_name, seed, due) => {
    expect(simplerSheetDue(seed)).toBe(due)
    const { opened } = mount(seed, { agents: NOTHING })
    expect(opened).toBe(due)
    expect(document.querySelector('[data-idealize-simpler]') !== null).toBe(due)
  })

  it('never shows for a seed the wizard opens on', () => {
    for (const [, seed] of seeds) {
      const flow = createOnboardingFlow({ persist: () => {}, releaseHold: () => {} })
      expect(flow.open(seed) && simplerSheetDue(seed)).toBe(false)
    }
  })
})

describe('the welcome sheet', () => {
  it('says what changed', async () => {
    mount(UPDATED, { agents: EVERYTHING, launches: launches(['claude-code']) })
    await flush()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('IDEalize is simpler now')
    expect(screen.getByText('IDEalize is simpler now')).toBeDefined()
    expect(screen.getByText(
      'Brains and the five spaces have gone. You pick Chat, Coding or Studio and start typing. Your projects and chats are all still here.',
    )).toBeDefined()
    expect(text('[data-simpler-later]')).toBe('Not now')
    expect(text('[data-simpler-save]')).toBe('Save and continue')
  })

  it('reads Ready on every row for someone who has everything, and asks for nothing', async () => {
    mount(UPDATED, { agents: EVERYTHING, launches: launches(['claude-code']) })
    await flush()
    expect(status('coding')).toBe('ready')
    expect(text('[data-simpler-row="coding"] [data-simpler-status]')).toBe('✓Ready')
    expect(text('[data-simpler-coding-runs]')).toBe('Runs on your subscription, through Claude Code.')
    expect(document.querySelector('[data-setup-cli]')).toBeNull()
    expect(status('chat')).toBe('ready')
    expect(text('[data-simpler-chat-runs]')).toBe('Run on your OpenRouter key.')
    expect(document.querySelector('[data-setup-openrouter]')).toBeNull()
    expect(document.querySelector('[data-simpler-row="fal"]')).toBeNull()
    expect(document.querySelector('[data-setup-fal]')).toBeNull()
  })

  it('reads the Coding row from the launch command in use', async () => {
    mount(UPDATED, { agents: EVERYTHING, launches: launches(['codex'], 'codex') })
    await flush()
    expect(status('coding')).toBe('ready')
    expect(text('[data-simpler-coding-runs]')).toBe('Runs on your subscription, through Codex CLI.')
  })

  it('asks for a coding app when the launch app is not installed, with the first installed one selected', async () => {
    mount(UPDATED, { agents: EVERYTHING, launches: launches(['codex', 'gemini']) })
    await flush()
    expect(status('coding')).toBe('needs')
    expect(text('[data-simpler-row="coding"] [data-simpler-status]')).toBe('Needs set-up')
    expect([...document.querySelectorAll('[data-setup-cli]')].map(row => row.getAttribute('data-setup-cli')))
      .toEqual(['claude-code', 'codex', 'gemini'])
    expect((one('[data-setup-cli="codex"] input') as HTMLInputElement).checked).toBe(true)
    expect(text('[data-simpler-coding-runs]')).toBe('Runs on your subscription, through Codex CLI.')
  })

  it('selects nothing over a launch command of the person\'s own', async () => {
    const { calls } = mount(UPDATED, { agents: EVERYTHING, launches: launches(['codex'], 'ccr code') })
    await flush()
    expect(status('coding')).toBe('needs')
    expect(document.querySelector('[data-setup-cli] input:checked')).toBeNull()
    expect(text('[data-simpler-coding-runs]')).toBe('Runs on your subscription, through ccr.')
    fireEvent.click(one('[data-simpler-save]'))
    await flush()
    expect(posts(calls)).toEqual([])
  })

  it('asks for an OpenRouter key when none is connected', async () => {
    mount(UPDATED, { agents: { ...EVERYTHING, openrouter: { connected: false } }, launches: launches(['claude-code']) })
    await flush()
    expect(status('chat')).toBe('needs')
    expect(text('[data-simpler-row="chat"] [data-simpler-status]')).toBe('Needs a key')
    expect(text('[data-simpler-row="chat"] [data-setup-block="openrouter"] span')).toBe('OpenRouter key')
    expect(text('[data-setup-reason="openrouter"]')).toContain('For Chat, and for the image, video and sound models Studio recommends.')
    expect(document.querySelector('[data-setup-openrouter]')).not.toBeNull()
    expect(one('[data-setup-get-key="openrouter"]').getAttribute('href')).toBe('https://openrouter.ai/keys')
    // No default chat model on another connected service: the sheet makes no promise.
    expect(document.querySelector('[data-simpler-fallback]')).toBeNull()
  })

  it('says Chat keeps working when the default chat model is on another connected service', async () => {
    const agents = { ...EVERYTHING, openrouter: { connected: false } }
    const state = (provider: string, connected: boolean) => ({
      default: { provider, model: 'a-model' },
      providers: [{ provider, displayName: 'DeepSeek', connected, models: [] }],
    })
    mount(UPDATED, { agents, launches: launches(['claude-code']), modelsState: state('deepseek-official', true) })
    await flush()
    expect(text('[data-simpler-fallback]')).toBe('Chat keeps working on DeepSeek until you add one.')
    cleanup()

    mount(UPDATED, { agents, launches: launches(['claude-code']), modelsState: state('deepseek-official', false) })
    await flush()
    expect(document.querySelector('[data-simpler-fallback]')).toBeNull()
    cleanup()

    mount(UPDATED, { agents, launches: launches(['claude-code']), modelsState: state('openrouter', true) })
    await flush()
    expect(document.querySelector('[data-simpler-fallback]')).toBeNull()
  })

  it('shows the fal block, marked Optional, while no fal key is connected', async () => {
    mount(UPDATED, { agents: { ...EVERYTHING, fal: { connected: false } }, launches: launches(['claude-code']) })
    await flush()
    expect(text('[data-simpler-row="fal"] [data-setup-optional]')).toBe('Optional')
    expect(text('[data-setup-reason="fal"]')).toBe('For access to more image, sound and video models in Studio.')
    expect(document.querySelector('[data-setup-fal]')).not.toBeNull()
  })

  it('Not now saves nothing, records the sheet as seen, and releases the tour', async () => {
    const { calls, markSeen, releaseHold } = mount(UPDATED, { agents: NOTHING, launches: launches(['codex']) })
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-typed' } })
    fireEvent.click(one('[data-simpler-later]'))
    await flush()
    expect(posts(calls)).toEqual([])
    expect(markSeen).toHaveBeenCalledTimes(1)
    expect(releaseHold).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-idealize-simpler]')).toBeNull()
  })

  it('Save and continue saves the pasted keys, aligns the app chosen here, and records the sheet as seen', async () => {
    const { calls, markSeen, releaseHold } = mount(UPDATED, { agents: NOTHING, launches: launches(['codex', 'gemini']) })
    await flush()
    const changed = vi.fn()
    document.addEventListener('idealize:brains-changed', changed)
    fireEvent.click(one('[data-setup-cli="gemini"] input'))
    expect(text('[data-setup-match]')).toBe('Chat will start on Gemini models, to match your subscription.')
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-good' } })
    fireEvent.change(one('[data-setup-fal]'), { target: { value: 'fal-good' } })
    fireEvent.click(one('[data-simpler-save]'))
    await flush()
    document.removeEventListener('idealize:brains-changed', changed)
    expect(posts(calls)).toEqual([
      ['/idealize/onboarding/openrouter', { apiKey: 'sk-or-good' }],
      ['/idealize/brains/services', { id: 'fal', kind: 'media', apiKey: 'fal-good' }],
      ['/idealize/onboarding/align', { cli: 'gemini' }],
    ])
    expect(calls.filter(call => call.method === 'POST').every(call => call.headers['x-idealize-auth'] === '1')).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(markSeen).toHaveBeenCalledTimes(1)
    expect(releaseHold).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-idealize-simpler]')).toBeNull()
  })

  it('a key added while Coding is already Ready moves Chat to that app\'s company', async () => {
    const { calls, markSeen } = mount(UPDATED, {
      agents: { ...EVERYTHING, openrouter: { connected: false } },
      launches: launches(['claude-code', 'codex']),
    })
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-good' } })
    fireEvent.click(one('[data-simpler-save]'))
    await flush()
    expect(posts(calls)).toEqual([
      ['/idealize/onboarding/openrouter', { apiKey: 'sk-or-good' }],
      ['/idealize/onboarding/align', { cli: 'claude-code' }],
    ])
    expect(markSeen).toHaveBeenCalledTimes(1)
  })

  it('Save and continue with nothing to save still records the sheet as seen', async () => {
    const { calls, markSeen } = mount(UPDATED, { agents: EVERYTHING, launches: launches(['claude-code']) })
    await flush()
    fireEvent.click(one('[data-simpler-save]'))
    await flush()
    expect(posts(calls)).toEqual([])
    expect(markSeen).toHaveBeenCalledTimes(1)
  })

  it('stays open, unrecorded, when a key is refused', async () => {
    const { markSeen, releaseHold } = mount(UPDATED, {
      agents: NOTHING,
      launches: launches(['claude-code']),
      posts: { '/idealize/onboarding/openrouter': { status: 400, body: { ok: false, error: 'OpenRouter rejected that key. Check it and try again.' } } },
    })
    await flush()
    fireEvent.change(one('[data-setup-openrouter]'), { target: { value: 'sk-or-bad' } })
    fireEvent.click(one('[data-simpler-save]'))
    await flush()
    expect(text('[data-setup-error="openrouter"]')).toContain('rejected')
    expect(markSeen).not.toHaveBeenCalled()
    expect(releaseHold).not.toHaveBeenCalled()
    expect(document.querySelector('[data-idealize-simpler]')).not.toBeNull()
  })

  it('still offers both buttons when the host cannot be read', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    const markSeen = vi.fn()
    const sheet = createSimplerSheet({ markSeen, releaseHold: () => {} })
    sheet.open(UPDATED)
    const props = {
      useSheet: bindSnapshotSelector(sheet.view),
      t,
      api: createOnboardingApi(failing),
      close: sheet.close,
    } as unknown as SimplerSheetProps
    render(<SimplerSheet {...props} />)
    await flush()
    expect(text('[data-simpler-loading]')).toBe(en['agents.loadError'])
    fireEvent.click(one('[data-simpler-later]'))
    expect(markSeen).toHaveBeenCalledTimes(1)
  })
})
