// @vitest-environment jsdom
// The compact panel's edges: the empty-draft guard, the refused send and its
// retry reset, and the identity header when the project path has no basename.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Panel } from '../src/client/Panel.tsx'
import { en } from '../src/client/locales.ts'
import type { AskbarChip } from '../src/types.ts'

const t = makeTranslate(en)

/** The comm sends among a fetch mock's calls; the panel also reads the transcript over the same route. */
const sends = (fetchMock: { mock: { calls: unknown[][] } }) =>
  fetchMock.mock.calls.filter(call => (JSON.parse((call[1] as { body: string }).body) as { command: string }).command === 'send')

const CHIP: AskbarChip = {
  id: 's-juno', name: 'Juno', title: 'Launch email', role: 'chat', running: true,
  unread: 0, state: 'ready', task: null, status: null,
}

function mount(project = '/work/demo') {
  const onClose = vi.fn()
  const onExpand = vi.fn()
  const view = render(<Panel chip={CHIP} project={project} edge='right' fromHold={false} initialDraft='' onClose={onClose} onExpand={onExpand} t={t} />)
  return { view, onClose, onExpand }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Panel', () => {
  it('shows the chat’s recent exchanges and reads them again after a send', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body) as { command: string }
      calls.push(request.command)
      if (request.command === 'transcript') {
        const second = calls.filter(c => c === 'transcript').length > 1
        return { ok: true, json: async () => ({ ok: true, exchanges: [
          { index: 1, question: 'Draft the launch email', answer: 'Here is a first draft.' },
          ...second ? [{ index: 2, question: 'Warmer tone', answer: undefined }] : [],
        ] }) }
      }
      return { ok: true, json: async () => ({ ok: true }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    await waitFor(() => { expect(view.getByText('Here is a first draft.')).toBeTruthy() })
    expect(view.getByText('Draft the launch email')).toBeTruthy()
    const field = view.getByPlaceholderText('Ask Juno')
    fireEvent.change(field, { target: { value: 'Warmer tone' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    // The answer is still to come: the running agent's line says so.
    await waitFor(() => { expect(view.getByText('Working on it…')).toBeTruthy() })
    expect(calls).toEqual(['transcript', 'send', 'transcript'])
  })

  it('says when nothing has been said, and keeps the list on a failed read', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, exchanges: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    await waitFor(() => { expect(view.getByText('Nothing said in this chat yet.')).toBeTruthy() })
  })

  it('labels a rootless project by its full path', () => {
    const { view } = mount('/')
    expect(view.getByRole('dialog').textContent).toContain('/ · Ready')
  })

  it('says a finished agent is safe to close', () => {
    const view = render(<Panel chip={{ ...CHIP, state: 'finished' }} project='/work/demo' edge='right' fromHold={false} initialDraft='' onClose={vi.fn()} onExpand={vi.fn()} t={t} />)
    expect(view.getByRole('dialog').textContent).toContain('demo · Finished, safe to close')
  })

  it('sends nothing while the draft is empty', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    fireEvent.keyDown(view.getByPlaceholderText('Ask Juno'), { key: 'Enter' })
    fireEvent.click(view.getByText('Send'))
    expect(sends(fetchMock)).toHaveLength(0)
  })

  it('shows Retry on a refused send, and typing arms Send again', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    const field = view.getByPlaceholderText('Ask Juno')
    fireEvent.change(field, { target: { value: 'Go with the warm tone' } })
    fireEvent.keyDown(field, { key: 'a' })
    expect(sends(fetchMock)).toHaveLength(0)
    fireEvent.click(view.getByText('Send'))
    await waitFor(() => { expect(view.getByText('Retry')).toBeTruthy() })
    fireEvent.change(field, { target: { value: 'Go with the warm tone!' } })
    expect(view.getByText('Send')).toBeTruthy()
  })
})
