// @vitest-environment jsdom
// The floating home: the drag-region root around the shared rail, the
// sidebar's order (brand mark, Studio entry, chips), one chip per roster row
// with its state label, the panel's five elements and its comm send, the hold
// → speech-notice flow with Esc discarding, the arrow-key path between chips,
// and the transform route the project cell and Studio entry post to. The voice
// flow past the notice lives in voice.client.spec.tsx, which stubs a recorder.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AskbarRoot, OWL_SRC } from '../src/client/AskbarRoot.tsx'
import type { AskbarView } from '../src/client/askbar-store.ts'
import { en } from '../src/client/locales.ts'
import { SPEECH_NOTICE_KEY } from '../src/client/speech-notice.ts'
import type { AskbarRoster } from '../src/types.ts'

const t = makeTranslate(en)

const ROSTER: AskbarRoster = {
  project: '/work/demo',
  config: { edge: 'right', hoverRevealMs: 150, pendingSendMs: 1000, transformMs: 200, pollMs: 2000 },
  chips: [
    { id: 's-juno', name: 'Juno', title: 'Launch email', role: 'chat', running: true, unread: 0, state: 'needs-input', task: 'Draft the launch email', status: 'Outlined both tones. Waiting on your pick.' },
    { id: 's-nova', name: 'Nova', title: 'Captions', role: 'project-agent', running: true, unread: 0, state: 'working', task: null, status: null },
    { id: 's-rye', name: 'Rye', title: 'Quiet chat', role: 'chat', running: false, unread: 0, state: 'idle', task: null, status: null },
    { id: 's-ivy', name: 'Ivy', title: 'Data pull', role: 'chat', running: true, unread: 3, state: 'wrong', task: null, status: null },
  ],
}

function mount(view0: AskbarView = { project: '/work/demo', roster: ROSTER, error: null }) {
  const store = createSnapshotStore<AskbarView>(view0)
  const view = render(<AskbarRoot store={store} t={t} />)
  return { store, view }
}

const TRANSFORM_PATH = '/idealize/askbar/transform'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.removeItem(SPEECH_NOTICE_KEY)
})

describe('AskbarRoot', () => {
  it('renders one chip per agent with its state name', () => {
    const { view } = mount()
    expect(view.getByLabelText('Juno — Needs input')).toBeTruthy()
    expect(view.getByLabelText('Nova — Working')).toBeTruthy()
    expect(view.getByLabelText('Rye — Idle')).toBeTruthy()
  })

  it('captions each chip with the agent’s name, and the floating bar adds the state under it', () => {
    const { view } = mount()
    const chip = view.getByLabelText('Juno — Needs input')
    // The portraits are generated, so the name is what ties a chip to a chat
    // in the sidebar (JJ, 11 Sep 2026).
    const lines = [...chip.querySelectorAll('span')].map(node => node.textContent).filter(Boolean)
    expect(lines).toContain('Juno')
    expect(lines).toContain('Needs input')
  })

  it('wraps the rail in the window’s drag-region root, docked to the configured edge', () => {
    const { view } = mount()
    const bar = view.container.firstElementChild as HTMLElement
    expect(bar.hasAttribute('data-askbar-bar')).toBe(true)
    expect(bar.getAttribute('data-edge')).toBe('right')
    const rail = bar.firstElementChild as HTMLElement
    expect(rail.hasAttribute('data-askbar-rail')).toBe(true)
    expect(rail.getAttribute('data-home')).toBe('floating')
    expect(bar.childElementCount).toBe(1)
  })

  it('orders the column as the sidebar does: brand mark and project, New chat, the Studio entry, then the agents', () => {
    const { view } = mount()
    const rail = view.container.querySelector('[data-askbar-rail]') as HTMLElement
    const [project, newChat, studio, rule, list] = [...rail.children] as HTMLElement[]
    expect(project?.getAttribute('aria-label')).toBe('demo — expand to the main window')
    expect(project?.querySelector('img')?.getAttribute('width')).toBe('58')
    // The sidebar carries its own New chat above the seat; the bar had none
    // until JJ asked for it back (13 Sep 2026).
    expect(newChat?.getAttribute('aria-label')).toBe('New chat — start one in the main window')
    expect(studio?.getAttribute('aria-label')).toBe('Studio — open it in the main window')
    expect(studio?.textContent).toBe('Studio')
    expect(studio?.querySelector('img')?.getAttribute('src')).toBe(OWL_SRC)
    // A rule closes the Studio off from the agents under it, in both homes.
    expect(rule?.tagName).toBe('HR')
    expect(list?.getAttribute('aria-label')).toBe('Agents')
    expect(view.queryByText('Group chat')).toBeNull()
  })

  it('opens the panel on Enter with the five elements, and Escape closes it', () => {
    const { view } = mount()
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    const panel = view.getByRole('dialog')
    expect(panel.textContent).toContain('Juno')
    expect(panel.textContent).toContain('demo')
    expect(panel.textContent).toContain('Draft the launch email')
    expect(panel.textContent).toContain('Outlined both tones. Waiting on your pick.')
    expect(view.getByPlaceholderText('Ask Juno')).toBeTruthy()
    expect(panel.textContent).toContain('Open the Studio')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('sends the ask field through comm and reports the send', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    fireEvent.change(view.getByPlaceholderText('Ask Juno'), { target: { value: 'Go with the warm tone' } })
    fireEvent.keyDown(view.getByPlaceholderText('Ask Juno'), { key: 'Enter' })
    await waitFor(() => { expect(view.getByText('Sent')).toBeTruthy() })
    // The open panel also asks the window for room, so the send is found by
    // its route rather than by being first.
    const [url, init] = fetchMock.mock.calls
      .find(call => call[0] === '/idealize/comm' && typeof (call[1] as RequestInit).body === 'string' && ((call[1] as RequestInit).body as string).includes('"command":"send"')) as [string, RequestInit]
    expect(url).toBe('/idealize/comm')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-idealize-auth': '1' })
    expect(init.body).toBe(JSON.stringify({ command: 'send', from: 'user', target: 's-juno', body: 'Go with the warm tone' }))
  })

  it('meets the first hold with the notice, and opens no microphone until it is read', () => {
    vi.useFakeTimers()
    const { view } = mount()
    fireEvent.pointerDown(view.getByLabelText('Nova — Working'))
    act(() => { vi.advanceTimersByTime(300) })
    const card = view.getByRole('status')
    expect(card.textContent).toContain('Hold a chip to speak')
    expect(card.textContent).toContain('reaches no network')
    // The chip is not listening: nothing was recorded behind the notice.
    expect(view.queryByLabelText('Nova — Listening')).toBeNull()
  })

  it('remembers the notice once it is read, so the next hold goes straight to the microphone', () => {
    vi.useFakeTimers()
    const { view } = mount()
    fireEvent.pointerDown(view.getByLabelText('Nova — Working'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.click(view.getByText('Got it'))
    expect(view.queryByRole('status')).toBeNull()
    expect(localStorage.getItem(SPEECH_NOTICE_KEY)).toBe('1')
  })

  it('Escape discards the notice without recording it as read', () => {
    vi.useFakeTimers()
    const { view } = mount()
    fireEvent.pointerDown(view.getByLabelText('Nova — Working'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('status')).toBeNull()
    expect(localStorage.getItem(SPEECH_NOTICE_KEY)).toBeNull()
  })

  it('a short press opens the panel instead of holding', () => {
    vi.useFakeTimers()
    const { view } = mount()
    const chip = view.getByLabelText('Juno — Needs input')
    fireEvent.pointerDown(chip)
    act(() => { vi.advanceTimersByTime(100) })
    fireEvent.pointerUp(chip)
    expect(view.getByRole('dialog').textContent).not.toContain('Read this back')
  })

  it('arrow keys move focus between chips', () => {
    const { view } = mount()
    const juno = view.getByLabelText('Juno — Needs input')
    juno.focus()
    fireEvent.keyDown(juno, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(view.getByLabelText('Nova — Working'))
    fireEvent.keyDown(view.getByLabelText('Nova — Working'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(juno)
  })

  it('states an empty project honestly', () => {
    const { view } = mount({ project: '/work/demo', roster: { ...ROSTER, chips: [] }, error: null })
    expect(view.getByText('No agents in this project yet')).toBeTruthy()
  })

  it('renders the wrong-state badge and the unread count', () => {
    const { view } = mount()
    const ivy = view.getByLabelText('Ivy — Something’s wrong')
    expect(ivy.textContent).toContain('×')
    expect(ivy.textContent).toContain('3')
  })

  it('renders before the first roster read, and arrow keys stay quiet with no chips', () => {
    const { view } = mount({ project: '', roster: null, error: null })
    expect(view.getByText('No project open yet')).toBeTruthy()
    const bar = view.container.firstElementChild as HTMLElement
    expect(bar.getAttribute('data-edge')).toBe('left')
    const rail = view.container.querySelector('[data-askbar-rail]') as HTMLElement
    fireEvent.keyDown(rail, { key: 'ArrowDown' })
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('shows the host error when a read fails with no roster to show', () => {
    const { view } = mount({ project: '/work/demo', roster: { ...ROSTER, chips: [] }, error: 'roster read failed: 500' })
    expect(view.getByText('Host unreachable')).toBeTruthy()
    expect(view.getByText('roster read failed: 500')).toBeTruthy()
  })

  it('requests the maxi transform from the project cell, the Studio from its entry and the panel foot, and survives a failed one', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockRejectedValueOnce(new Error('host gone'))
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    fireEvent.click(view.getByLabelText('demo — expand to the main window'))
    fireEvent.click(view.getByLabelText('Studio — open it in the main window'))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(2) })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(TRANSFORM_PATH)
    expect(init.body).toBe(JSON.stringify({ to: 'maxi' }))
    // The Studio entry names the project so the main window opens the Studio with it as context.
    const [, studio] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(studio.body as string)).toEqual({ to: 'maxi', open: 'studio', project: '/work/demo' })
    expect(view.getByLabelText('Juno — Needs input')).toBeTruthy()
    // The panel foot asks for the same. Opening the panel also asks the
    // window for room, so the transform is found by its route.
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    fireEvent.click(view.getByText('Open the Studio ↗'))
    await waitFor(() => { expect(fetchMock.mock.calls.filter(call => call[0] === TRANSFORM_PATH)).toHaveLength(3) })
    const [, foot] = fetchMock.mock.calls.filter(call => call[0] === TRANSFORM_PATH)[2] as [string, RequestInit]
    expect(JSON.parse(foot.body as string)).toEqual({ to: 'maxi', open: 'studio', project: '/work/demo' })
    // The room came from the window rather than from a clipped panel.
    const [, width] = fetchMock.mock.calls.find(call => call[0] === '/idealize/askbar/width') as [string, RequestInit]
    expect(JSON.parse(width.body as string)).toEqual({ width: 420 })
  })

  it('asks for the Studio without a project when none is open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount({ project: '', roster: null, error: null })
    fireEvent.click(view.getByLabelText('Studio — open it in the main window'))
    await waitFor(() => { expect(fetchMock).toHaveBeenCalledOnce() })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ to: 'maxi', open: 'studio' })
  })

  it('a key other than Escape leaves the hold card up', () => {
    vi.useFakeTimers()
    const { view } = mount()
    fireEvent.pointerDown(view.getByLabelText('Nova — Working'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.keyDown(window, { key: 'a' })
    expect(view.getByRole('status')).toBeTruthy()
  })

  it('the pointer leaving the chip cancels a hold without opening anything', () => {
    vi.useFakeTimers()
    localStorage.setItem(SPEECH_NOTICE_KEY, '1')
    const { view } = mount()
    const chip = view.getByLabelText('Nova — Working')
    fireEvent.pointerDown(chip)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.pointerLeave(chip)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(view.queryByRole('status')).toBeNull()
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('a stray pointer release or leave with no press does nothing', () => {
    const { view } = mount()
    const chip = view.getByLabelText('Nova — Working')
    fireEvent.pointerUp(chip)
    fireEvent.pointerLeave(chip)
    expect(view.queryByRole('dialog')).toBeNull()
  })

  it('closes the panel when its agent leaves the roster', () => {
    const { store, view } = mount()
    fireEvent.keyDown(view.getByLabelText('Juno — Needs input'), { key: 'Enter' })
    expect(view.getByRole('dialog')).toBeTruthy()
    act(() => { store.set({ project: '/work/demo', roster: { ...ROSTER, chips: ROSTER.chips.filter(chip => chip.id !== 's-juno') }, error: null }) })
    expect(view.queryByRole('dialog')).toBeNull()
  })
})
