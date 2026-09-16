// @vitest-environment jsdom
// The Service hatch chat pane: every failure path renders a visible message
// (probe, session create, send), an adopted session shows the full
// transcript (user/assistant/tool/error rows), and the composer validates
// attachments.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { ChatConversationViewNode, SessionBinding } from '@deepseek-ai/dsh-client-runtime/client'
import { en } from '../src/client/locales.ts'
import { ServiceSection } from '../src/client/ServiceSection.tsx'
import type { ServiceSectionInjected, ServiceSectionProps } from '../src/client/ServiceSection.tsx'
// Type-only: the locale-namespace and slot-key merges the props type reads.
import type {} from '../src/client/index.ts'

const t: ServiceSectionProps['t'] = makeTranslate(en, commonEn)

const SERVICE_OK = {
  path: '/Users/jj/dev/idealize',
  valid: true,
  configured: false,
  workspaceId: null,
}

function okFetch(body: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    json: async () => body,
  })) as unknown as typeof fetch
}

function chatNode(kind: string, key: string, data: unknown): ChatConversationViewNode {
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    data,
    anchorSeq: 1,
    location: { kind: 'session' },
    visibility: 'visible',
  } as unknown as ChatConversationViewNode
}

function fakeBinding(nodes: readonly ChatConversationViewNode[], overrides: Record<string, unknown> = {}) {
  const snapshot = {
    chat: {
      order: nodes.map(node => node.key),
      nodes: {
        get: (key: string) => nodes.find(node => node.key === key),
        values: () => nodes,
      },
    },
    running: false,
    promptError: null,
    ...overrides,
  }
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const session = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    prompt,
    cancel: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
  }
  const binding = { sessionId: 'hatch-1', session, ctx: {} } as unknown as SessionBinding
  return { binding, prompt }
}

function mount(overrides: Partial<ServiceSectionInjected> = {}) {
  const injected: ServiceSectionInjected = {
    adoptSession: () => null,
    ensureSession: () => Promise.reject(new Error('unexpected ensureSession')),
    openModels: vi.fn(),
    ...overrides,
  }
  const view = render(
    <ServiceSection t={t} {...injected} />,
  )
  return { view, injected }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => `blob:${Math.random().toString(36).slice(2)}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ServiceSection', () => {
  it('renders a missing-model send failure as a notice whose button opens the Brains pane', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const { binding } = fakeBinding([], {
      promptError: { time: 0, error: { code: 'MISSING_CREDENTIAL', message: 'no credential for route' } },
    })
    const openModels = vi.fn()
    const { view } = mount({ adoptSession: () => binding, openModels })
    const button = await view.findByRole('button', { name: 'Connect a model' })
    expect(view.getByText(/isn’t connected yet/)).toBeTruthy()
    fireEvent.click(button)
    expect(openModels).toHaveBeenCalledTimes(1)
  })

  it('renders a missing-model turn error (accepted prompt, failed turn) with the same connect notice', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const nodes = [
      chatNode('turn-error', 'e1', { kind: 'turn-error', seq: 2, time: 0, turn: 1, step: 1, code: 'MISSING_CREDENTIAL', message: 'no credential' }),
    ]
    const { binding } = fakeBinding(nodes)
    const openModels = vi.fn()
    const { view } = mount({ adoptSession: () => binding, openModels })
    const button = await view.findByRole('button', { name: 'Connect a model' })
    fireEvent.click(button)
    expect(openModels).toHaveBeenCalledTimes(1)
  })

  it('surfaces a probe failure with a retry, and recovers on retry', async () => {
    const failing = vi.fn(async () => { throw new Error('down') })
    vi.stubGlobal('fetch', failing)
    const { view } = mount()
    await view.findByText(/hatch\/service route didn’t answer/)
    const input = view.getByPlaceholderText('What shall we change?') as HTMLTextAreaElement
    expect(input.disabled).toBe(true)
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    fireEvent.click(view.getByRole('button', { name: 'Try again' }))
    await view.findByText(/dev\/idealize/)
    await waitFor(() => { expect(input.disabled).toBe(false) })
  })

  it('renders the adopted transcript: user, assistant, tool card, and failure rows', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const nodes = [
      chatNode('user', 'n1', {
        kind: 'user',
        seq: 1,
        time: 0,
        content: [{ type: 'text', text: 'make the drawer wider' }],
        source: null,
      }),
      chatNode('assistant-step', 'n2', {
        status: 'settled',
        turn: 1,
        step: 1,
        time: 0,
        blocks: [{ kind: 'text', text: 'On it.' }],
      }),
      chatNode('tool-call', 'n3', {
        root: {
          kind: 'tool-result',
          seq: 3,
          time: 0,
          callId: 'c1',
          call: { name: 'bash', argsRaw: '{"command":"ls"}' },
          callTime: 0,
          content: [{ type: 'text', text: 'lib src' }],
          isError: false,
          callView: null,
          resultView: null,
          subCalls: [],
        },
      }),
      chatNode('turn-error', 'n4', {
        kind: 'turn-error',
        seq: 4,
        time: 0,
        turn: 1,
        step: 1,
        message: 'engine unreachable',
      }),
    ]
    const { binding } = fakeBinding(nodes)
    const { view } = mount({ adoptSession: () => binding })
    await view.findByText('make the drawer wider')
    expect(view.getByText('On it.')).toBeTruthy()
    expect(view.getByText('bash')).toBeTruthy()
    expect(view.getByText('command: ls')).toBeTruthy()
    expect(view.getByText('lib src')).toBeTruthy()
    expect(view.getByText('engine unreachable')).toBeTruthy()
  })

  it('creates the session on first send and prompts it', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const { binding, prompt } = fakeBinding([])
    const ensureSession = vi.fn(async () => binding)
    const { view } = mount({ ensureSession })
    await view.findByText(/dev\/idealize/)
    const input = view.getByPlaceholderText('What shall we change?') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'rename the wrench tooltip' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'rename the wrench tooltip' }], 'queue')
    })
    expect(ensureSession).toHaveBeenCalledWith(SERVICE_OK.path)
    await waitFor(() => { expect(input.value).toBe('') })
  })

  it('shows the session-create failure in the pane and keeps the draft', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const ensureSession = vi.fn(async () => { throw new Error('workspace create refused') })
    const { view } = mount({ ensureSession })
    await view.findByText(/dev\/idealize/)
    const input = view.getByPlaceholderText('What shall we change?') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'try me' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await view.findByText(/Couldn’t start the service chat: workspace create refused/)
    expect(input.value).toBe('try me')
    expect(input.disabled).toBe(false)
  })

  it('renders the session-mirrored send failure', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const { binding } = fakeBinding([], {
      promptError: { op: 'send', error: { code: 'E', message: 'prompt rejected' } },
    })
    const { view } = mount({ adoptSession: () => binding })
    await view.findByText(/Send failed: prompt rejected/)
  })

  it('lands the quote inside the chat, typing indicator first, never in the banner', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const { binding } = fakeBinding([])
    const { view } = mount({ adoptSession: () => binding })
    // The indicator holds the seat while the line "types".
    expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(view.queryByText(/peculiar dialect/)).toBeNull()
    const quote = await view.findByText(/peculiar dialect/, {}, { timeout: 3000 })
    expect(quote.closest('header')).toBeNull()
  })

  it('edits the source in place: persists it and re-adopts the session at the new path', async () => {
    const moved = { ...SERVICE_OK, path: '/Users/jj/dev/idealize-v2', configured: true }
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => ({
      ok: true,
      json: async () => init?.method === 'POST' ? moved : SERVICE_OK,
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { binding } = fakeBinding([])
    const adoptSession = vi.fn(() => binding)
    const { view } = mount({ adoptSession })
    await view.findByText(/dev\/idealize$/)

    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const input = view.getByLabelText('Source') as HTMLInputElement
    expect(input.value).toBe(SERVICE_OK.path)
    fireEvent.change(input, { target: { value: moved.path } })
    fireEvent.click(view.getByRole('button', { name: 'Save' }))

    await view.findByText(/idealize-v2/)
    const post = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')
    expect(post).toBeTruthy()
    expect((post![1] as { headers: Record<string, string> }).headers['x-idealize-auth']).toBe('1')
    expect(JSON.parse((post![1] as { body: string }).body)).toEqual({ path: moved.path })
    expect(adoptSession).toHaveBeenLastCalledWith(moved.path)
    // The form closed back to the Source line.
    expect(view.queryByLabelText('Source')).toBeNull()
  })

  it('keeps the editor open and shows the refusal when the edit is rejected', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => init?.method === 'POST'
      ? { ok: false, status: 422, json: async () => ({ error: 'no service checkout at /nope' }) }
      : { ok: true, json: async () => SERVICE_OK })
    vi.stubGlobal('fetch', fetchMock)
    const { view } = mount()
    await view.findByText(/dev\/idealize/)

    fireEvent.click(view.getByRole('button', { name: 'Edit' }))
    const input = view.getByLabelText('Source') as HTMLInputElement
    fireEvent.change(input, { target: { value: '/nope' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await view.findByText(/Couldn’t change the source: no service checkout at \/nope/)
    expect(view.getByLabelText('Source')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(view.queryByLabelText('Source')).toBeNull()
  })

  it('rejects non-image attachments visibly and rails accepted ones', async () => {
    vi.stubGlobal('fetch', okFetch(SERVICE_OK))
    const { view } = mount()
    await view.findByText(/dev\/idealize/)
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    const bad = new File(['nope'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(fileInput!, { target: { files: [bad] } })
    await view.findByText('Only PNG, JPEG, WebP or GIF images can be attached.')
    const good = new File(['png-bytes'], 'shot.png', { type: 'image/png' })
    fireEvent.change(fileInput!, { target: { files: [good] } })
    await view.findByAltText('shot.png')
  })
})
