// @vitest-environment jsdom
// The starting points under the hero composer: brains as roles with examples
// that fill the composer, spaces beside them, and every refusal stated with a
// way forward. Nothing is ever dimmed or disabled.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SpaceRosterEntry } from '@idealize/spaces/client'
import { en } from '../src/client/locales.ts'
import { HeroBrains, type HeroBrainsProps } from '../src/client/HeroBrains.tsx'
import type { BrainAccess, HeroLauncherInjected, LauncherSession, TerminalLaunches } from '../src/client/HeroLauncher.tsx'
import { suggestSpace } from '../src/client/suggest-space.ts'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: HeroBrainsProps['t'] = makeTranslate(en, commonEn)
const unused = (() => undefined) as unknown as HeroBrainsProps['useSessions'] & HeroBrainsProps['useWorkspaces']

const CHAT: SpaceRosterEntry = {
  id: 'chat',
  brainCount: 3,
  brains: [
    { id: 'coding', name: 'Coding', default: true },
    { id: 'design', name: 'Design', model: { provider: 'openai', model: 'gpt-5' } },
    { id: 'mine', name: 'Mine' },
  ],
  models: 'some',
}
const LONE_GALLERY: SpaceRosterEntry = {
  id: 'gallery',
  brainCount: 1,
  brains: [{ id: 'gallery', name: 'Gallery', default: true, model: { provider: 'fal', model: 'flux' } }],
  models: 'some',
}
const KEYLESS_GALLERY: SpaceRosterEntry = {
  id: 'gallery',
  brainCount: 1,
  brains: [{ id: 'gallery', name: 'Gallery', default: true }],
  models: 'none',
  reason: 'no-compatible-model',
  recovery: 'No connected provider offers a compatible image model.',
  keyMissing: true,
}
const TERMINAL: SpaceRosterEntry = {
  id: 'terminal',
  brainCount: 3,
  brains: [
    { id: 'coding', name: 'Coding', default: true, model: { provider: 'openai', model: 'gpt-5' } },
    { id: 'design', name: 'Design', model: { provider: 'openai-codex', model: 'gpt-5.6-terra' } },
    { id: 'admin', name: 'Admin' },
  ],
  models: 'some',
}
const ROSTER: SpaceRosterEntry[] = [
  CHAT,
  TERMINAL,
  LONE_GALLERY,
  { id: 'soundstage', brainCount: 0, brains: [], models: 'some' },
  {
    id: 'motion',
    brainCount: 0,
    brains: [],
    models: 'none',
    reason: 'no-compatible-model',
    recovery: 'No connected provider offers a compatible video model. Store the provider’s API key in Settings.',
    keyMissing: true,
  },
]

interface MountOptions {
  roster?: readonly SpaceRosterEntry[]
  access?: Readonly<Record<string, BrainAccess>>
  launches?: TerminalLaunches
  session?: LauncherSession
  draft?: string
  projectOpen?: boolean
  enter?: () => Promise<boolean>
}

function mount(options: MountOptions = {}) {
  const roster = options.roster ?? ROSTER
  const enter = vi.fn(options.enter ?? (() => Promise.resolve(true)))
  const prepare = vi.fn(() => Promise.resolve())
  const noteTyping = vi.fn()
  const addBrain = vi.fn()
  const addKey = vi.fn()
  const signIn = vi.fn()
  const setDraft = vi.fn()
  const load = vi.fn(() => Promise.resolve(roster))
  let session: LauncherSession = options.session ?? { id: 's1', blank: true }
  const spaces: HeroLauncherInjected['spaces'] = {
    load,
    access: () => Promise.resolve(options.access ?? {}),
    enter,
    prepare,
    noteTyping,
    addBrain,
    addKey,
    signIn,
    terminalLaunches: () => Promise.resolve(options.launches),
  }
  const element = (draft: string) => (
    <HeroBrains
      t={t}
      useSessions={unused}
      useWorkspaces={unused}
      spaces={spaces}
      currentSession={() => session}
      projectOpen={options.projectOpen ?? true}
      draft={draft}
      setDraft={setDraft}
    />
  )
  const view = render(element(options.draft ?? ''))
  return {
    view, enter, prepare, noteTyping, addBrain, addKey, signIn, setDraft, load,
    rerender: (draft: string, next?: LauncherSession) => {
      if (next !== undefined) session = next
      view.rerender(element(draft))
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

const card = (view: ReturnType<typeof mount>['view'], id: string): HTMLElement =>
  view.container.querySelector<HTMLElement>(`[data-brain-card="${id}"]`)!

afterEach(cleanup)

describe('the cards', () => {
  it('shows a brain card for each Chat brain plus Images, and the other spaces beside them', async () => {
    const { view } = mount()
    await settle()
    expect([...view.container.querySelectorAll('[data-brain-card]')].map(node => node.getAttribute('data-brain-card')))
      .toEqual(['coding', 'design', 'mine', 'gallery'])
    expect([...view.container.querySelectorAll('[data-space]')].map(node => node.getAttribute('data-space')))
      .toEqual(['soundstage', 'motion', 'terminal'])
    expect(view.container.textContent).toContain('these are only starting points')
  })

  it('never disables a control, whatever the roster says', async () => {
    const { view } = mount({ roster: [CHAT, KEYLESS_GALLERY], access: { coding: { state: 'unavailable', reason: 'no-access', model: { provider: 'openrouter', model: 'x' } } } })
    await settle()
    const buttons = [...view.container.querySelectorAll('button')]
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.every(button => !button.disabled)).toBe(true)
  })

  it('marks the brain the chat runs on, and a press on it only focuses the composer', async () => {
    const { view, enter } = mount()
    await settle()
    expect(card(view, 'coding').hasAttribute('data-brain-selected')).toBe(true)
    fireEvent.click(card(view, 'coding').querySelector('button')!)
    await settle()
    expect(enter).not.toHaveBeenCalled()
  })

  it('a press on another brain moves this chat onto it and keeps what is typed', async () => {
    const { view, enter, setDraft } = mount({ draft: 'half a thought' })
    await settle()
    fireEvent.click(card(view, 'design').querySelector('button')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('chat', 'design', 's1')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('an example fills the composer on that brain', async () => {
    const { view, enter, setDraft } = mount()
    await settle()
    fireEvent.click(card(view, 'coding').querySelector('[data-brain-example]')!)
    expect(setDraft).toHaveBeenCalledWith('Fix the broken menu on my site')
    expect(enter).not.toHaveBeenCalled()
    fireEvent.click(card(view, 'design').querySelector('[data-brain-example]')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('chat', 'design', 's1')
    expect(setDraft).toHaveBeenLastCalledWith('Tidy up this page\'s layout')
  })

  it('a brain somebody wrote shows its name with no invented purpose or examples', async () => {
    const { view } = mount()
    await settle()
    expect(card(view, 'mine').textContent).toBe('Mine')
  })

  it('a blocked brain says what it needs, and its press opens the fix for that route', async () => {
    const { view, addKey, enter } = mount({ access: { coding: { state: 'unavailable', reason: 'no-access', model: { provider: 'openrouter', model: 'x' } } } })
    await settle()
    expect(card(view, 'coding').textContent).toContain('Needs an account.')
    expect(card(view, 'coding').querySelector('[data-brain-example]')).toBeNull()
    fireEvent.click(card(view, 'coding').querySelector('button')!)
    expect(addKey).toHaveBeenCalledWith('openrouter')
    expect(enter).not.toHaveBeenCalled()
  })

  it('a route waiting on a sign-in opens the sign-in surface', async () => {
    const { view, signIn } = mount({ access: { design: { state: 'unavailable', reason: 'no-sign-in', model: { provider: 'openai-codex', model: 'x' } } } })
    await settle()
    fireEvent.click(card(view, 'design').querySelector('button')!)
    expect(signIn).toHaveBeenCalled()
  })

  it('marks Images as needing an account when the chat route driving its tool has none', async () => {
    // Its catalogue is public, so `models: some` alone would tick a card that cannot run.
    const blocked = { state: 'unavailable', reason: 'no-access', model: null } as const
    const { view } = mount({ access: { gallery: blocked } })
    await settle()
    expect(card(view, 'gallery').querySelector('[data-brain-card-needs]')?.textContent).toContain('Needs an account.')
  })

  it('reloads when the Brains pane reports a change', async () => {
    const { load } = mount()
    await settle()
    await act(async () => {
      document.dispatchEvent(new Event('idealize:brains-changed'))
      await Promise.resolve()
    })
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('a blank chat', () => {
  it('goes onto its brain once when the card shows, without recording it', async () => {
    const { prepare, noteTyping, rerender } = mount()
    await settle()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledWith('coding', 's1')
    expect(noteTyping).not.toHaveBeenCalled()
    rerender('')
    await settle()
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it('goes onto the preset it was created on when that is one of Chat\'s brains', async () => {
    const { prepare } = mount({ session: { id: 's1', blank: true, agentPreset: 'design' } })
    await settle()
    expect(prepare).toHaveBeenCalledWith('design', 's1')
  })

  it('records the brain once, when typing starts', async () => {
    const { noteTyping, rerender } = mount()
    await settle()
    rerender('hello')
    await settle()
    rerender('hello there')
    await settle()
    expect(noteTyping).toHaveBeenCalledTimes(1)
    expect(noteTyping).toHaveBeenCalledWith('coding', 's1')
  })

  it('leaves a chat that already records a brain alone', async () => {
    const { prepare, noteTyping } = mount({ session: { id: 's1', blank: true, brain: 'design' }, draft: 'hi' })
    await settle()
    expect(prepare).not.toHaveBeenCalled()
    expect(noteTyping).not.toHaveBeenCalled()
  })

  it('prepares each new blank chat again', async () => {
    const { prepare, rerender } = mount()
    await settle()
    rerender('', { id: 's2', blank: true })
    await settle()
    expect(prepare).toHaveBeenLastCalledWith('coding', 's2')
  })
})

describe('where the band shows', () => {
  it('stays away without a project, on a started chat, and on a chat in another space', async () => {
    expect(mount({ projectOpen: false }).view.container.textContent).toBe('')
    cleanup()
    expect(mount({ session: { id: 's1', blank: false } }).view.container.textContent).toBe('')
    cleanup()
    expect(mount({ session: { id: 's1', blank: true, space: 'gallery' } }).view.container.textContent).toBe('')
    cleanup()
    expect(mount({ session: { id: 's1', blank: true, space: 'studio' } }).view.container.textContent).toBe('')
  })
})

describe('spaces', () => {
  it('starts a space\'s one reachable brain at once, skipping the brain step', async () => {
    const { view, enter } = mount()
    await settle()
    fireEvent.click(card(view, 'gallery').querySelector('button')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('gallery', 'gallery', 's1')
    expect(view.container.querySelector('[data-launcher-step="brain"]')).toBeNull()
  })

  it('an Images example starts Images, then fills the composer', async () => {
    const { view, enter, setDraft } = mount()
    await settle()
    fireEvent.click(card(view, 'gallery').querySelector('[data-brain-example]')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('gallery', 'gallery', 's1')
    expect(setDraft).toHaveBeenCalledWith('A poster of an owl reading')
  })

  it('falls back to the brain step when the host refuses an auto-start', async () => {
    const { view } = mount({ enter: () => Promise.resolve(false) })
    await settle()
    fireEvent.click(card(view, 'gallery').querySelector('button')!)
    await settle()
    expect(view.container.querySelector('[data-launcher-step="brain"]')).not.toBeNull()
  })

  it('offers Images\' account from the card when a key is what is missing', async () => {
    const { view, addKey } = mount({ roster: [CHAT, KEYLESS_GALLERY] })
    await settle()
    expect(card(view, 'gallery').textContent).toContain('Needs an account.')
    fireEvent.click(card(view, 'gallery').querySelector('button')!)
    expect(addKey).toHaveBeenCalled()
  })

  it('offers Add a brain where models exist and no brain does', async () => {
    const { view, addBrain } = mount()
    await settle()
    fireEvent.click(view.container.querySelector('[data-space="soundstage"]')!)
    await settle()
    fireEvent.click(view.container.querySelector('[data-launcher-add-brain="soundstage"]')!)
    expect(addBrain).toHaveBeenCalledWith('soundstage')
  })

  it('states the recovery where no model can serve a space, with the key and the way back', async () => {
    const { view, addKey } = mount()
    await settle()
    fireEvent.click(view.container.querySelector('[data-space="motion"]')!)
    await settle()
    expect(view.container.querySelector('[data-launcher-refusal]')).not.toBeNull()
    fireEvent.click(view.container.querySelector('[data-launcher-add-key]')!)
    expect(addKey).toHaveBeenCalled()
    fireEvent.click(view.container.querySelector('[data-launcher-back]')!)
    expect(view.container.querySelector('[data-brain-card]')).not.toBeNull()
  })

  it('names the CLI each Terminal brain launches, never its chat model or key', async () => {
    const { view, enter } = mount({
      access: { admin: { state: 'unavailable', reason: 'no-access', model: { provider: 'deepseek-official', model: 'x' } } },
      launches: {
        default: 'claude',
        byActivity: { design: 'codex', admin: '' },
        catalog: [
          { id: 'claude-code', label: 'Claude Code', command: 'claude', installed: true },
          { id: 'codex', label: 'Codex', command: 'codex', installed: false },
        ],
      },
    })
    await settle()
    fireEvent.click(view.container.querySelector('[data-space="terminal"]')!)
    await settle()
    expect([...view.container.querySelectorAll('[data-brain]')].map(row => row.getAttribute('data-brain-cli')))
      .toEqual(['Claude Code', 'Codex', 'Plain shell'])
    expect(view.container.textContent).not.toContain('gpt-5.6-terra')
    fireEvent.click(view.container.querySelector('[data-brain="admin"]')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('terminal', 'admin', 's1')
  })
})

describe('the suggestion', () => {
  it('offers Images for an ask to make a picture, and keeps the words when taken', async () => {
    const { view, enter, setDraft } = mount({ draft: 'make me a poster of an owl' })
    await settle()
    const row = view.container.querySelector('[data-hero-suggest="gallery"]')!
    expect(row.textContent).toContain('This looks like an image.')
    fireEvent.click(row.querySelector('[data-hero-suggest-make]')!)
    await settle()
    expect(enter).toHaveBeenCalledWith('gallery', 'gallery', 's1')
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('goes away on Keep asking here', async () => {
    const { view, enter } = mount({ draft: 'draw a logo' })
    await settle()
    fireEvent.click(view.container.querySelector('[data-hero-suggest-keep]')!)
    expect(view.container.querySelector('[data-hero-suggest]')).toBeNull()
    expect(enter).not.toHaveBeenCalled()
  })

  it('reads asks to make media, and leaves work on existing things alone', () => {
    expect(suggestSpace('Make an image of a fox')).toBe('gallery')
    expect(suggestSpace('please generate 3 logos for a bakery')).toBe('gallery')
    expect(suggestSpace('create a short video about owls')).toBe('motion')
    expect(suggestSpace('compose a jingle')).toBe('soundstage')
    expect(suggestSpace('Fix the logo on my site')).toBeUndefined()
    expect(suggestSpace('Why is this image not loading?')).toBeUndefined()
    expect(suggestSpace('')).toBeUndefined()
  })
})
