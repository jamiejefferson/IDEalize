// @vitest-environment jsdom
/**
 * The chime row and its plugin: the sound picker lists the host's catalogue
 * with the built-in chime named in the locale's words, choosing a sound
 * saves it and plays it, and the done chime plays whatever was chosen.
 */
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { closeBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'
import { BUILT_IN_CHIME, type ChimeSound } from '../src/chime-sounds.ts'
import { apply, inject, ChimeRow, type IdealizeNotify } from '../src/client/index.ts'
import type { ChimePreference, ChimeRowInjected } from '../src/client/ChimeRow.tsx'
import type { NotifySettings } from '../src/settings.ts'

usePinnedBrowserLanguages('en')

/** Every Audio element the code under test made, in order. */
const played: { src: string; volume: number }[] = []
class FakeAudio {
  volume = 1
  constructor(public src: string) {}
  play(): Promise<void> {
    played.push({ src: this.src, volume: this.volume })
    return Promise.resolve()
  }
}

afterEach(() => {
  cleanup()
  closeBridgeFeed()
  vi.unstubAllGlobals()
  played.splice(0)
})

const unused = (): never => { throw new Error('unused hook') }
const t = (key: string): string => key
const catalogue: ChimeSound[] = [BUILT_IN_CHIME, { id: 'system:Glass', label: 'Glass' }, { id: 'system:Ping', label: 'Ping' }]

function row(preference: Partial<ChimePreference> = {}, sounds: ChimeSound[] = catalogue) {
  const chime = createSnapshotStore<ChimePreference>({ enabled: true, volume: 0.4, sound: 'built-in', ...preference })
  const list = createSnapshotStore<ChimeSound[]>(sounds)
  const face = { setEnabled: vi.fn(), setVolume: vi.fn(), setSound: vi.fn(), preview: vi.fn() }
  const view = render(
    <ChimeRow
      useChime={bindSnapshotSelector(chime)}
      useSounds={bindSnapshotSelector(list)}
      {...face}
      t={t as never}
      useSessions={unused}
      useWorkspaces={unused}
    />,
  )
  return { view, chime, ...face }
}

describe('ChimeRow', () => {
  it('lists the catalogue with the built-in chime in the locale\'s words, and hands a choice to the face', () => {
    const { view, setSound } = row()
    const select = view.getByLabelText('chime.sound') as HTMLSelectElement
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['built-in', 'chime.sound.builtIn'],
      ['system:Glass', 'Glass'],
      ['system:Ping', 'Ping'],
    ])
    expect(select.value).toBe('built-in')
    fireEvent.change(select, { target: { value: 'system:Ping' } })
    expect(setSound).toHaveBeenCalledWith('system:Ping')
  })

  it('keeps a stored sound this machine does not list selectable, named without its prefix', () => {
    const { view } = row({ sound: 'system:Windows Ding' })
    const select = view.getByLabelText('chime.sound') as HTMLSelectElement
    expect(select.value).toBe('system:Windows Ding')
    expect([...select.options].at(-1)?.textContent).toBe('Windows Ding')
  })

  it('disables the picker with the rest of the controls when the chime is off', () => {
    const { view } = row({ enabled: false })
    expect((view.getByLabelText('chime.sound') as HTMLSelectElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: 'chime.preview' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

/** The plugin over a stubbed host: the catalogue route, the bridge feed's empty tail, and nothing else. */
async function plugin(answer: { status: number; body?: unknown } | Error = { status: 200, body: { sounds: catalogue } }) {
  vi.stubGlobal('Audio', FakeAudio)
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    if (input.startsWith('/idealize/events/')) return new Response('[]', { status: 200 })
    if (input === '/idealize/notify/sounds') {
      if (answer instanceof Error) throw answer
      return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status })
    }
    return new Response('{}', { status: 404 })
  }))
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const stub = stubSettingsScope<NotifySettings>()
  ctx.provide('settingsScope', { bind: () => stub.scope } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: { 'settings.general.item': { kind: 'list', scope: 'root' } } } as never, () => null)
  await ctx.plugin({ inject: [...inject], apply }).await()
  await new Promise(resolve => setTimeout(resolve, 0))
  const entry = slots.entries('settings.general.item').find(candidate => candidate.options.id === 'idealize-chime')
  const face = (entry?.inject as unknown as () => ChimeRowInjected)()
  const outputs = ctx.get('idealizeNotify') as IdealizeNotify
  return { ctx, face, stub, outputs }
}

describe('the plugin\'s chime preference', () => {
  it('reads the catalogue from the host and follows the stored choice', async () => {
    const { face, stub } = await plugin()
    expect(face.hooks.sounds.getSnapshot()).toEqual(catalogue)
    expect(face.hooks.chime.getSnapshot()).toEqual({ enabled: true, volume: 0.4, sound: 'built-in' })
    stub.publish({ status: 'ready', value: { chimeEnabled: true, chimeVolume: 0.7, chimeSound: 'system:Glass', lastSeenAnnouncementId: '' } })
    expect(face.hooks.chime.getSnapshot()).toEqual({ enabled: true, volume: 0.7, sound: 'system:Glass' })
  })

  it('saves a chosen sound and plays it at once; preview and the done chime play the choice', async () => {
    const { face, stub, outputs } = await plugin()
    face.setSound('system:Ping')
    expect(stub.set).toHaveBeenCalledWith('chimeSound', 'system:Ping')
    expect(face.hooks.chime.getSnapshot().sound).toBe('system:Ping')
    face.setVolume(0.9)
    face.preview()
    outputs.chime()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(played).toEqual([
      { src: '/idealize/notify/sound?id=system%3APing', volume: 0.4 },
      { src: '/idealize/notify/sound?id=system%3APing', volume: 0.9 },
      { src: '/idealize/notify/sound?id=system%3APing', volume: 0.9 },
    ])
    // Off, the done chime is silent.
    face.setEnabled(false)
    outputs.chime()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(played).toHaveLength(3)
  })

  it('keeps the built-in chime alone when the host cannot list sounds', async () => {
    const refused = await plugin({ status: 404 })
    expect(refused.face.hooks.sounds.getSnapshot()).toEqual([BUILT_IN_CHIME])
    await refused.ctx.fiber.dispose()
    closeBridgeFeed()
    const offline = await plugin(new Error('offline'))
    expect(offline.face.hooks.sounds.getSnapshot()).toEqual([BUILT_IN_CHIME])
    offline.outputs.chime()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(played).toEqual([{ src: '/idealize/notify/chime.mp3', volume: 0.4 }])
  })
})
