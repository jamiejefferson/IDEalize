// @vitest-environment jsdom
/**
 * The Telegram remote row and its plugin: token entry until a token is
 * stored, the Pair button and the live code, the paired state with its
 * forward switches, and the problem line; the plugin seats the row in
 * General settings, calls the host routes, keeps re-reading while a code is
 * live, and writes each toggle to the `idealize-telegram` scope.
 */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { apply, inject, TelegramRow } from '../src/client/index.ts'
import type { TelegramRowInjected, TelegramRowState } from '../src/client/TelegramRow.tsx'
import { TELEGRAM_DEFAULTS, type TelegramSettings, type TelegramStatus } from '../src/settings.ts'

usePinnedBrowserLanguages('en')
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const unused = (): never => { throw new Error('unused hook') }
const t = (key: string): string => key
const forward = { forwardStudioReplies: true, forwardTaskEndings: false, forwardAttention: true, forwardApprovals: true }
const unconfigured: TelegramStatus = { configured: false, shadowed: false, botUsername: '', paired: false, problem: '' }
const connected: TelegramStatus = { ...unconfigured, configured: true, botUsername: 'idealize_bot' }

function row(state: Partial<TelegramRowState> = {}) {
  const store = createSnapshotStore<TelegramRowState>({ status: unconfigured, forward, busy: false, error: '', ...state })
  const face = { refresh: vi.fn(), saveToken: vi.fn(), pair: vi.fn(), unpair: vi.fn(), setForward: vi.fn() }
  const view = render(
    <TelegramRow
      useTelegram={bindSnapshotSelector(store)}
      {...face}
      t={t as never}
      useSessions={unused}
      useWorkspaces={unused}
    />,
  )
  return { view, store, ...face }
}

describe('TelegramRow', () => {
  it('shows only its heading until the status arrives, and asks for it on mount', () => {
    const { view, refresh } = row({ status: undefined })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('form')).toBeNull()
    expect(view.queryByRole('button')).toBeNull()
  })

  it('takes a token, enabling Connect only once something is typed', () => {
    const { view, saveToken } = row()
    const input = view.getByLabelText('telegram.token.label') as HTMLInputElement
    const connect = view.getByRole('button', { name: 'telegram.token.save' }) as HTMLButtonElement
    expect(connect.disabled).toBe(true)
    fireEvent.change(input, { target: { value: '123:abc' } })
    expect(connect.disabled).toBe(false)
    fireEvent.submit(input.closest('form') as HTMLFormElement)
    expect(saveToken).toHaveBeenCalledWith('123:abc')
    expect(input.value).toBe('')
  })

  it('names the bot and removes the token, or explains an environment token', () => {
    const own = row({ status: connected })
    expect(own.view.container.textContent).toContain('telegram.connected @idealize_bot')
    fireEvent.click(own.view.getByRole('button', { name: 'telegram.token.remove' }))
    expect(own.saveToken).toHaveBeenCalledWith('')
    cleanup()
    const shadowed = row({ status: { ...connected, shadowed: true, botUsername: '' } })
    expect(shadowed.view.queryByRole('button', { name: 'telegram.token.remove' })).toBeNull()
    expect(shadowed.view.container.textContent).toContain('telegram.token.shadowed')
    expect(shadowed.view.container.textContent).not.toContain('@')
  })

  it('offers Pair, then shows the code to send', () => {
    const offer = row({ status: connected })
    fireEvent.click(offer.view.getByRole('button', { name: 'telegram.pair' }))
    expect(offer.pair).toHaveBeenCalled()
    cleanup()
    const waiting = row({ status: { ...connected, pairing: { code: '123456', expiresAt: 0 } } })
    expect(waiting.view.container.querySelector('[data-pairing-code]')?.textContent)
      .toBe('telegram.pair.send /pair 123456 telegram.pair.expires')
  })

  it('shows the paired state with a switch per forward kind', () => {
    const { view, unpair, setForward } = row({ status: { ...connected, paired: true } })
    fireEvent.click(view.getByRole('button', { name: 'telegram.unpair' }))
    expect(unpair).toHaveBeenCalled()
    const switches = view.getAllByRole('switch')
    expect(switches.map(element => element.getAttribute('aria-checked'))).toEqual(['true', 'false', 'true', 'true'])
    fireEvent.click(switches[1] as HTMLElement)
    expect(setForward).toHaveBeenCalledWith('forwardTaskEndings', true)
  })

  it('shows the host problem, a route refusal in its place, and disables buttons while busy', () => {
    const problem = row({ status: { ...connected, problem: 'Telegram could not be reached.' } })
    expect(problem.view.getByRole('status').textContent).toBe('Telegram could not be reached.')
    cleanup()
    const refused = row({ status: { ...connected, problem: 'x' }, error: 'Save a bot token first.', busy: true })
    expect(refused.view.getByRole('status').textContent).toBe('Save a bot token first.')
    expect((refused.view.getByRole('button', { name: 'telegram.pair' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

interface Reply {
  status: number
  body: unknown
}

async function plugin(replies: Array<Reply | Error | string> = []) {
  const calls: { url: string; method: string; headers: unknown; body: unknown }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers, body: init?.body })
    const next = replies.shift() ?? { status: 200, body: connected }
    if (next instanceof Error || typeof next === 'string') throw next
    return new Response(JSON.stringify(next.body), { status: next.status })
  }))
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const stub = stubSettingsScope<TelegramSettings>()
  const bind = vi.fn(() => stub.scope)
  ctx.provide('settingsScope', { bind } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  await ctx.plugin({ inject: [...inject], apply }).await()
  const entry = slots.entries('settings.general.item').find(candidate => candidate.options.id === 'idealize-telegram')
  const face = (entry?.inject as unknown as () => TelegramRowInjected)()
  return { ctx, face, stub, bind, calls }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('the plugin\'s settings row', () => {
  it('binds the idealize-telegram scope and follows the stored toggles', async () => {
    const { face, stub, bind } = await plugin()
    expect(bind).toHaveBeenCalledWith({ namespace: 'idealize-telegram' })
    const { chatId: _chatId, ...toggles } = TELEGRAM_DEFAULTS
    expect(face.hooks.telegram.getSnapshot().forward).toEqual(toggles)
    stub.publish({ status: 'ready', value: { ...TELEGRAM_DEFAULTS, forwardAttention: false } })
    expect(face.hooks.telegram.getSnapshot().forward.forwardAttention).toBe(false)
  })

  it('reads the status, stores a token, pairs and unpairs through the routes', async () => {
    const { face, calls } = await plugin()
    face.refresh()
    await flush()
    expect(face.hooks.telegram.getSnapshot()).toMatchObject({ status: connected, busy: false, error: '' })
    face.saveToken('123:abc')
    await flush()
    face.pair()
    await flush()
    face.unpair()
    await flush()
    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['GET', '/idealize/telegram/status'],
      ['POST', '/idealize/telegram/token'],
      ['POST', '/idealize/telegram/pair'],
      ['DELETE', '/idealize/telegram/pair'],
    ])
    expect(calls[0]?.headers).toEqual({})
    expect(calls[1]).toMatchObject({ headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' }, body: '{"token":"123:abc"}' })
    expect(calls[2]?.body).toBeUndefined()
  })

  it('shows a refusal in the host\'s words, or the status code and thrown reason when there are none', async () => {
    const { face } = await plugin([
      { status: 400, body: { error: 'Telegram did not accept this token.' } },
      { status: 500, body: {} },
      new Error('offline'),
      'plain failure',
    ])
    face.saveToken('999:bad')
    await flush()
    expect(face.hooks.telegram.getSnapshot()).toMatchObject({ busy: false, error: 'Telegram did not accept this token.' })
    face.pair()
    await flush()
    expect(face.hooks.telegram.getSnapshot().error).toBe('HTTP 500')
    face.refresh()
    await flush()
    expect(face.hooks.telegram.getSnapshot().error).toBe('offline')
    face.refresh()
    await flush()
    expect(face.hooks.telegram.getSnapshot().error).toBe('plain failure')
  })

  it('writes a toggle to the scope at once', async () => {
    const { face, stub } = await plugin()
    face.setForward('forwardApprovals', false)
    expect(stub.set).toHaveBeenCalledWith('forwardApprovals', false)
    expect(face.hooks.telegram.getSnapshot().forward.forwardApprovals).toBe(false)
  })

  it('re-reads the status while a code is live and stops with the plugin', async () => {
    vi.useFakeTimers()
    const { ctx, face, calls } = await plugin([
      { status: 200, body: { ...connected, pairing: { code: '123456', expiresAt: 0 } } },
    ])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toHaveLength(0)
    face.pair()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls.map(call => call.url)).toEqual(['/idealize/telegram/pair', '/idealize/telegram/status'])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(calls).toHaveLength(2)
    await ctx.fiber.dispose()
  })
})
