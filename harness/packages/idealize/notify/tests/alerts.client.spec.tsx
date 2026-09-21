// @vitest-environment jsdom
/**
 * The Studio's alerts in the window: an `attention` frame on the bridge feed
 * raises one notification the person can answer, opening it asks this window
 * for that exact Studio event and records `opened`, letting it go records
 * `dismissed`, and the Askbar window stays quiet so one event alerts once.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { closeBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { onStudioRequest } from '@idealize/askbar/src/client/studio-request.ts'
import { apply, inject } from '../src/client/index.ts'
import type { NotifySettings } from '../src/settings.ts'

/** One raised notification, with the handlers the plugin hung on it. */
class FakeNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn(async () => FakeNotification.permission)
  static raised: FakeNotification[] = []
  onclick: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly title: string, readonly options: { body?: string } = {}) {
    FakeNotification.raised.push(this)
  }
}

/** The bridge feed, as one attachable stream. */
class FakeEventSource {
  static open: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | null = null
  closed = false
  constructor(readonly url: string) { FakeEventSource.open.push(this) }
  close() { this.closed = true }
}

const frame = (over: Record<string, unknown> = {}) => JSON.stringify({
  seq: 9, kind: 'attention', title: 'agent-alpha needs your input', body: 'Which font?',
  project: '/work/demo', studioEvent: 'se-7', ...over,
})

const posts: { url: string; body: unknown }[] = []

async function bench(search = '') {
  window.history.replaceState(null, '', `/${search}`)
  posts.length = 0
  FakeNotification.raised = []
  FakeEventSource.open = []
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    if (init?.method === 'POST') posts.push({ url: href, body: JSON.parse(init.body as string) })
    if (href.startsWith('/idealize/events/recent')) return new Response('[]', { status: 200 })
    return new Response('{}', { status: 200 })
  }))
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const settings = stubSettingsScope<NotifySettings>()
  ctx.provide('settingsScope', { bind: () => settings.scope } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.banner': { kind: 'list', scope: 'root' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  await ctx.plugin({ name: 'idealize-notify-client', inject: [...inject], apply })
  await new Promise(resolve => setTimeout(resolve, 0))
  const push = (data: string): void => { FakeEventSource.open.at(-1)?.onmessage?.({ data }) }
  return { ctx, push }
}

afterEach(() => {
  closeBridgeFeed()
  vi.unstubAllGlobals()
  FakeNotification.permission = 'granted'
  FakeNotification.requestPermission = vi.fn(async () => FakeNotification.permission)
  window.history.replaceState(null, '', '/')
})

describe('the Studio’s alerts in the window', () => {
  it('raises one notification carrying the alert’s words', async () => {
    const { push } = await bench()
    push(frame())
    await Promise.resolve()
    expect(FakeNotification.raised).toHaveLength(1)
    expect(FakeNotification.raised[0]?.title).toBe('agent-alpha needs your input')
    expect(FakeNotification.raised[0]?.options.body).toBe('Which font?')
  })

  it('opens the exact Studio event and records it, once', async () => {
    const { push } = await bench()
    const opened: (string | undefined)[] = []
    const off = onStudioRequest(studioEvent => opened.push(studioEvent))
    push(frame())
    await Promise.resolve()
    const raised = FakeNotification.raised[0]
    raised?.onclick?.()
    // A click closes the notification; that is not a dismissal.
    raised?.onclose?.()
    await Promise.resolve()
    off()
    expect(opened).toEqual(['se-7'])
    expect(posts).toEqual([{ url: '/idealize/notify/attention/state', body: { event: 'se-7', state: 'opened' } }])
  })

  it('records an alert the person let go', async () => {
    const { push } = await bench()
    push(frame())
    await Promise.resolve()
    FakeNotification.raised[0]?.onclose?.()
    await Promise.resolve()
    expect(posts).toEqual([{ url: '/idealize/notify/attention/state', body: { event: 'se-7', state: 'dismissed' } }])
  })

  it('stays quiet in the Askbar window, so one event alerts once', async () => {
    const { push } = await bench('?dsh-desktop-mode=askbar')
    push(frame())
    await Promise.resolve()
    expect(FakeNotification.raised).toHaveLength(0)
    expect(posts).toEqual([])
  })

  it('raises nothing for a frame that names no Studio event', async () => {
    const { push } = await bench()
    push(frame({ studioEvent: undefined }))
    push('not json')
    await Promise.resolve()
    expect(FakeNotification.raised).toHaveLength(0)
  })

  it('asks for permission first, then raises the alert', async () => {
    FakeNotification.permission = 'default'
    FakeNotification.requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'granted'
      return FakeNotification.permission
    })
    const { push } = await bench()
    push(frame())
    await Promise.resolve()
    await Promise.resolve()
    expect(FakeNotification.requestPermission).toHaveBeenCalled()
    expect(FakeNotification.raised).toHaveLength(1)
  })

  it('falls back to the host route in a browser with no Notification at all', async () => {
    const { push } = await bench()
    vi.stubGlobal('Notification', undefined)
    push(frame())
    await Promise.resolve()
    await Promise.resolve()
    expect(posts.map(post => post.url)).toEqual(['/idealize/notify/native'])
  })

  it('chimes for an agent finishing, and raises no Studio alert for it', async () => {
    const { push } = await bench()
    push(JSON.stringify({ seq: 11, kind: 'agent-finished', title: '', body: '' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(posts.map(post => post.url)).toEqual(['/idealize/notify/native'])
  })

  it('says an agent stopped, rather than promising a reply, when its turn ended on an error', async () => {
    const { push } = await bench()
    push(JSON.stringify({ seq: 12, kind: 'agent-finished', title: '', body: '', failed: true }))
    await Promise.resolve()
    await Promise.resolve()
    expect(posts).toHaveLength(1)
    expect(JSON.stringify(posts[0])).toContain('Agent stopped')
    expect(JSON.stringify(posts[0])).not.toContain('reply is ready')
  })

  it('falls back to the host’s own notification when the browser refuses permission', async () => {
    FakeNotification.permission = 'denied'
    const { push } = await bench()
    push(frame())
    await Promise.resolve()
    await Promise.resolve()
    expect(FakeNotification.raised).toHaveLength(0)
    expect(posts.map(post => post.url)).toEqual(['/idealize/notify/native'])
  })
})
