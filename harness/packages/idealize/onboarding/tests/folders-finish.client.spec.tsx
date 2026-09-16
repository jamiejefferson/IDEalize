// @vitest-environment jsdom
// The folder steps and the finish step over the real flow + api layer: the
// probe gates Continue and reports the host's verbatim refusal, the picker and
// the setup aliases pre-fill, orientation runs with both folders and the
// first-project name, its per-field refusals render in place, and the
// Settings re-run row resets the seed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { createOnboardingFlow } from '../src/client/flow.ts'
import { createOnboardingApi } from '../src/client/api.ts'
import { OnboardingOverlay } from '../src/client/OnboardingOverlay.tsx'
import type { OnboardingOverlayProps } from '../src/client/OnboardingOverlay.tsx'
import { OnboardingRow } from '../src/client/OnboardingRow.tsx'
import type { OnboardingRowProps } from '../src/client/OnboardingRow.tsx'
import type { AgentsState } from '../src/client/api.ts'
import { en } from '../src/client/locales.ts'
import type { OnboardingSeedLike } from '../src/client/steps.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = (key: string): string => en[key as keyof typeof en] ?? key

/** Flush pending route promises and their effects. */
const flush = async (): Promise<void> => { await act(async () => {}) }

/** Advance the folder probe's debounce and flush the probe's round trip. */
const probe = async (): Promise<void> => {
  await act(async () => { vi.advanceTimersByTime(300) })
  await flush()
}

interface RecordedCall {
  path: string
  method: string
  body?: unknown
}

interface HarnessOptions {
  aliases?: { projectsRoot?: string; documentation?: string }
  /** Per-path POST response (default 200 { ok: true }). */
  posts?: Record<string, { status: number; body: unknown }>
  picked?: string | null
  agents?: AgentsState
}

function mount(seed: OnboardingSeedLike | undefined, options: HarnessOptions = {}) {
  vi.useFakeTimers()
  const writes: Record<string, unknown> = {}
  const releaseHold = vi.fn()
  const selectProject = vi.fn()
  const flow = createOnboardingFlow({
    persist: (field, value) => { writes[field] = value },
    releaseHold,
  })
  flow.open(seed)
  const posts = options.posts ?? {}
  const calls: RecordedCall[] = []
  const fetchFn = (async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET'
    calls.push({ path, method, ...init?.body === undefined ? {} : { body: JSON.parse(init.body) as unknown } })
    if (method === 'GET') {
      const payload = path === '/idealize/onboarding/agents'
        ? options.agents ?? { claudeCode: { installed: true, path: '/usr/local/bin/claude' }, openrouter: { connected: false } }
        : { providers: [], agents: [], presets: [] }
      return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response
    }
    const post = posts[path] ?? { status: 200, body: { ok: true } }
    return { ok: post.status === 200, status: post.status, json: () => Promise.resolve(post.body) } as unknown as Response
  }) as unknown as typeof fetch
  const props = {
    useView: bindSnapshotSelector(flow.view),
    t,
    api: createOnboardingApi(fetchFn),
    pickDirectory: () => Promise.resolve(options.picked ?? null),
    readSetupAliases: () => options.aliases ?? {},
    selectProject,
    completeStep: flow.completeStep,
    skipStep: flow.skipStep,
    quitAll: flow.quitAll,
    back: flow.back,
    setToolDrafts: flow.setToolDrafts,
    finish: flow.finish,
    celebrationDone: flow.celebrationDone,
    prefersReducedMotion: () => false,
  } as unknown as OnboardingOverlayProps
  render(<OnboardingOverlay {...props} />)
  return { flow, writes, releaseHold, selectProject, calls }
}

const continueButton = (): HTMLElement => screen.getByText(en['nav.continue'])

/** Type a path through the manual input and let its probe settle. */
const typePath = async (path: string): Promise<void> => {
  fireEvent.click(screen.getByText(en['folder.manual']))
  fireEvent.change(document.querySelector('[data-folder-input]')!, { target: { value: path } })
  await probe()
}

const FOLDERS_SEED: OnboardingSeedLike = { steps: { agents: 'done', tools: 'done' } }
const FINISH_SEED: OnboardingSeedLike = {
  steps: { agents: 'done', tools: 'done', 'projects-folder': 'skipped', 'documentation-folder': 'skipped', 'skills-folder': 'skipped' },
}

describe('the folder step bodies', () => {
  it('gates Continue on a live probe and renders the refusal verbatim', async () => {
    const posts = {
      '/idealize/setup/alias': { status: 400, body: { ok: false, failure: { accessState: 'missing', reason: 'There is no folder at /gone.' } } },
    }
    mount(FOLDERS_SEED, { posts })
    await flush()
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('projects-folder')
    expect(continueButton().hasAttribute('disabled')).toBe(true)

    await typePath('/gone')
    expect(document.querySelector('[data-folder-error]')?.textContent).toBe('There is no folder at /gone.')
    expect(continueButton().hasAttribute('disabled')).toBe(true)
  })

  it('probes a good path through the alias route and advances', async () => {
    const { calls, writes } = mount(FOLDERS_SEED)
    await flush()

    await typePath('/Users/jj/Projects')
    expect(calls.some(call => call.path === '/idealize/setup/alias'
      && (call.body as { name?: string }).name === 'projectsRoot'
      && (call.body as { path?: string }).path === '/Users/jj/Projects')).toBe(true)
    expect(continueButton().hasAttribute('disabled')).toBe(false)

    fireEvent.click(continueButton())
    await flush()
    expect(writes.steps).toEqual({ agents: 'done', tools: 'done', 'projects-folder': 'done' })
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('documentation-folder')
  })

  it('fills from the directory picker', async () => {
    mount(FOLDERS_SEED, { picked: '/Users/jj/Picked' })
    await flush()
    fireEvent.click(screen.getByText(en['folder.choose']))
    await flush()
    await probe()
    expect(document.querySelector('[data-folder-value]')?.textContent).toBe('/Users/jj/Picked')
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })

  it('pre-fills from the existing setup aliases', async () => {
    mount(FOLDERS_SEED, { aliases: { projectsRoot: '/Users/jj/Existing' } })
    await probe()
    expect(document.querySelector('[data-folder-value]')?.textContent).toBe('/Users/jj/Existing')
    expect(continueButton().hasAttribute('disabled')).toBe(false)
  })
})

describe('the finish step body', () => {
  it('runs orientation with both folders and the project name, selects the project, and completes', async () => {
    const posts = {
      '/idealize/setup/orientation': {
        status: 200,
        body: { ok: true, project: { workspaceId: 'ws-1', path: '/Users/jj/Projects/My first project' } },
      },
    }
    const { calls, writes, releaseHold, selectProject } = mount(FOLDERS_SEED, { posts })
    await flush()
    await typePath('/Users/jj/Projects')
    fireEvent.click(continueButton())
    await flush()
    await typePath('/Users/jj/Notes')
    fireEvent.click(continueButton())
    await flush()
    await typePath('/Users/jj/Skills')
    fireEvent.click(continueButton())
    await flush()

    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('finish')
    expect((document.querySelector('[data-finish-project]') as HTMLInputElement).value).toBe(en['finish.project.default'])

    fireEvent.click(screen.getByText(en['nav.finish']))
    await flush()

    const orient = calls.find(call => call.path === '/idealize/setup/orientation')
    expect(orient?.body).toEqual({
      projectsFolder: '/Users/jj/Projects',
      documentationFolder: '/Users/jj/Notes',
      projectName: 'My first project',
    })
    expect(selectProject).toHaveBeenCalledWith('ws-1')
    expect(writes.done).toBe(true)
    expect(typeof writes.completedAt).toBe('string')
    expect(screen.getByRole('status').textContent).toBe(en['celebrate.finish'])

    act(() => { vi.advanceTimersByTime(900) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(releaseHold).toHaveBeenCalledTimes(1)
  })

  it('renders the orientation refusals verbatim and stays put', async () => {
    const posts = {
      '/idealize/setup/orientation': {
        status: 400,
        body: { ok: false, failures: [{ field: 'projectsFolder', reason: 'There is no folder at /gone.' }] },
      },
    }
    const { writes } = mount(FOLDERS_SEED, { posts })
    await flush()
    await typePath('/gone')
    fireEvent.click(continueButton())
    await flush()
    await typePath('/Users/jj/Notes')
    fireEvent.click(continueButton())
    await flush()
    await typePath('/Users/jj/Skills')
    fireEvent.click(continueButton())
    await flush()

    fireEvent.click(screen.getByText(en['nav.finish']))
    await flush()
    expect(document.querySelector('[data-finish-failure="projectsFolder"]')?.textContent).toBe('There is no folder at /gone.')
    expect(document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step')).toBe('finish')
    expect(writes.done).toBeUndefined()
  })

  it('refuses empty folders without calling the route (the skip path)', async () => {
    const { calls, writes } = mount(FINISH_SEED)
    await flush()
    fireEvent.click(screen.getByText(en['nav.finish']))
    await flush()
    expect(calls.some(call => call.path === '/idealize/setup/orientation')).toBe(false)
    expect(screen.getAllByText(en['finish.folderMissing'])).toHaveLength(2)
    expect(writes.done).toBeUndefined()
  })
})

describe('the Settings re-run row', () => {
  it('resets the seed and reports the re-armed state', () => {
    const rerun = vi.fn()
    const props = { t, rerun } as unknown as OnboardingRowProps
    render(<OnboardingRow {...props} />)
    fireEvent.click(screen.getByText(en['settings.rerun.action']))
    expect(rerun).toHaveBeenCalledTimes(1)
    expect(screen.getByText(en['settings.rerun.armed'])).toBeDefined()
  })
})
