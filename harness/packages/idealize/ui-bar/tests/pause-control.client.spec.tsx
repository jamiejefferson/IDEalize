// @vitest-environment jsdom
/**
 * Pause all agents at the sidebar foot (feedback 495cec0a; JJ, 30 Oct 2026):
 * the control shows the host's pause in each of its three phases, in the wide
 * and the collapsed sidebar, and the store presses the host and opens the
 * shells Resume names.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { closeBridgeFeed } from '@idealize/askbar/src/client/bridge-feed.ts'
import { PauseControl, PauseStore, type PauseTransport, type PauseView } from '../src/client/index.ts'

usePinnedBrowserLanguages('en')
afterEach(() => {
  cleanup()
  closeBridgeFeed()
})

const unused = (): never => { throw new Error('unused hook') }
const t = (key: string, values?: Record<string, string>): string => values === undefined ? key : `${key} ${JSON.stringify(values)}`

const RUNNING: PauseView = { phase: 'running', chats: [], saving: 0, working: 2 }
const SAVING: PauseView = {
  phase: 'saving',
  since: '2026-10-30T14:30:00.000Z',
  chats: [{ id: 'a', label: 'Watto', kind: 'chat', state: 'saving' }, { id: 'b', label: 'Bossk', kind: 'terminal', state: 'saving' }],
  saving: 2,
  working: 0,
}
const PAUSED: PauseView = { ...SAVING, phase: 'paused', chats: SAVING.chats.map(chat => ({ ...chat, state: 'stopped' })), saving: 0 }

/** A host that answers each press with the next phase, recording what it was asked. */
function fakeHost(start: PauseView | null) {
  const asked: string[] = []
  let current = start
  const transport: PauseTransport = {
    read: () => Promise.resolve(current),
    press: (action) => {
      asked.push(action)
      current = action === 'pause' ? SAVING : action === 'stop' ? PAUSED : RUNNING
      return Promise.resolve(action === 'resume' ? { ...current, open: [{ sessionId: 'b', cwd: '/Users/jj/AMI', activity: 'coding' }] } : current)
    },
    openShell: (shell) => {
      asked.push(`open ${shell.sessionId} ${shell.activity ?? ''}`)
      return Promise.resolve()
    },
  }
  return { transport, asked }
}

async function mount(start: PauseView | null, wide = true) {
  const host = fakeHost(start)
  const store = new PauseStore(host.transport)
  const view = render(
    <PauseControl
      wide={wide}
      usePause={bindSnapshotSelector(store.store)}
      press={action => store.press(action)}
      follow={() => { void store.load(); return () => {} }}
      t={t as never}
      useSessions={unused}
      useWorkspaces={unused}
    />,
  )
  await act(async () => { await Promise.resolve() })
  return { ...view, store, asked: host.asked }
}

describe('the Pause control', () => {
  it('renders nothing where the host serves no pause', async () => {
    const { container } = await mount(null)
    expect(container.innerHTML).toBe('')
  })

  it('walks from Pause through Stop now to Resume, and opens the shells Resume names', async () => {
    const { container, getByText, asked } = await mount(RUNNING)
    expect(container.querySelector('[data-pause-phase="running"]')).not.toBeNull()
    await act(async () => { fireEvent.click(getByText('pause.pause')) })
    expect(container.querySelector('[data-pause-phase="saving"]')).not.toBeNull()
    expect(getByText('pause.saving.other {"count":"2"}')).toBeDefined()
    await act(async () => { fireEvent.click(getByText('pause.stop')) })
    expect(getByText('pause.paused')).toBeDefined()
    await act(async () => { fireEvent.click(getByText('pause.resume')) })
    expect(container.querySelector('[data-pause-phase="running"]')).not.toBeNull()
    expect(asked).toEqual(['pause', 'stop', 'resume', 'open b coding'])
  })

  it('counts one agent in the singular, and shows a failed press', async () => {
    const { getByText, getByRole, store } = await mount({ ...SAVING, saving: 1 })
    expect(getByText('pause.saving.one')).toBeDefined()
    ;(store as unknown as { transport: PauseTransport }).transport.press = () => Promise.reject(new Error('host gone'))
    await act(async () => { fireEvent.click(getByText('pause.stop')) })
    expect(getByRole('alert').textContent).toBe('pause.failed {"error":"host gone"}')
  })

  it('shows one round button in the collapsed sidebar, labelled for its phase', async () => {
    const { container, asked } = await mount(PAUSED, false)
    const button = container.querySelector('button')!
    expect(button.getAttribute('data-pause-phase')).toBe('paused')
    expect(button.getAttribute('aria-label')).toBe('pause.resumeAll')
    await act(async () => { fireEvent.click(button) })
    expect(asked[0]).toBe('resume')
    expect(container.querySelector('button')!.getAttribute('aria-label')).toBe('pause.pause')
  })
})
