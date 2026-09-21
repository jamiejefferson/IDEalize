// @vitest-environment jsdom
// The hold gesture with a recorder in place: what the bar shows at each phase,
// where the transcript goes when the provider is confident and where it goes
// when it is not, what a refusal says, how a first-run model fetch is waited
// out, and that Escape releases the microphone and delivers nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { AskbarRoot } from '../src/client/AskbarRoot.tsx'
import type { AskbarView } from '../src/client/askbar-store.ts'
import { en } from '../src/client/locales.ts'
import { SPEECH_NOTICE_KEY } from '../src/client/speech-notice.ts'
import type { AskbarRoster } from '../src/types.ts'

const t = makeTranslate(en)

/** A one-second countdown makes the test slow; the roster carries the timing. */
const ROSTER: AskbarRoster = {
  project: '/work/demo',
  config: { edge: 'right', hoverRevealMs: 150, pendingSendMs: 10, transformMs: 200, pollMs: 2000 },
  chips: [
    { id: 's-nova', name: 'Nova', title: 'Captions', role: 'chat', running: true, unread: 0, state: 'working', task: null, status: null },
  ],
}

/** Every track the capture opened, so a test can assert the microphone was released. */
let stopped: number

/** Install a recorder, a microphone and a decoder in jsdom. */
function installRecorder(options: { deny?: boolean; noDevice?: boolean } = {}): void {
  stopped = 0
  class FakeRecorder {
    state = 'inactive'
    mimeType = 'audio/webm'
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()
    start(): void { this.state = 'recording' }
    stop(): void {
      this.state = 'inactive'
      for (const listener of this.listeners.get('dataavailable') ?? []) listener({ data: new Blob(['x']) })
      for (const listener of this.listeners.get('stop') ?? []) listener({})
    }
    addEventListener(name: string, listener: (event: unknown) => void): void {
      this.listeners.set(name, [...this.listeners.get(name) ?? [], listener])
    }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  vi.stubGlobal('AudioContext', class {
    decodeAudioData(): Promise<AudioBuffer> {
      return Promise.resolve({
        duration: 1,
        sampleRate: 16_000,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(16_000),
      } as unknown as AudioBuffer)
    }
    close(): Promise<void> { return Promise.resolve() }
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: () => {
        if (options.noDevice === true) return Promise.reject(Object.assign(new Error('none'), { name: 'NotFoundError' }))
        if (options.deny === true) return Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
        return Promise.resolve({ getTracks: () => [{ stop: () => { stopped += 1 } }] })
      },
    },
  })
  // jsdom's Blob has no arrayBuffer in this version; the capture reads one.
  if (Blob.prototype.arrayBuffer as unknown === undefined) {
    Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> { return Promise.resolve(new ArrayBuffer(8)) }
  }
}

/** The routes the flow calls, each answering what the test set. */
function installFetch(answers: {
  transcribe?: { status: number; body: unknown }
  state?: unknown
  comm?: { ok: boolean }
}) {
  const calls: { url: string; body?: unknown }[] = []
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, body: init?.body })
    const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
    if (url.startsWith('/idealize/transcribe/state')) return json(200, answers.state ?? { providers: [], readiness: { state: 'ready' } })
    if (url.startsWith('/idealize/transcribe/prepare')) return json(200, { readiness: { state: 'ready' } })
    if (url.startsWith('/idealize/transcribe')) {
      const answer = answers.transcribe ?? { status: 200, body: { text: 'move the plan icon', confident: true, ms: 5 } }
      return json(answer.status, answer.body)
    }
    if (url === '/idealize/comm') return json(200, answers.comm ?? { ok: true })
    return json(200, {})
  })
  vi.stubGlobal('fetch', mock)
  return calls
}

function mount(roster: typeof ROSTER = ROSTER) {
  const store = createSnapshotStore<AskbarView>({ project: '/work/demo', roster, error: null })
  return render(<AskbarRoot store={store} t={t} />)
}

/** Press and hold a chip past the gesture threshold. */
async function hold(view: ReturnType<typeof mount>): Promise<HTMLElement> {
  const chip = view.getByLabelText('Nova — Working')
  fireEvent.pointerDown(chip)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 260)) })
  return chip
}

beforeEach(() => {
  localStorage.setItem(SPEECH_NOTICE_KEY, '1')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.removeItem(SPEECH_NOTICE_KEY)
})

describe('holding a chip to speak', () => {
  it('opens the panel as a click does when no speech provider is composed, and never opens the microphone', async () => {
    installRecorder()
    const calls = installFetch({})
    const view = mount({ ...ROSTER, config: { ...ROSTER.config, speech: false } })

    const chip = await hold(view)
    expect(view.queryByLabelText('Nova — Listening')).toBeNull()
    fireEvent.pointerUp(chip)

    await waitFor(() => { expect(view.container.querySelector('[data-askbar-panel]')).not.toBeNull() })
    expect(view.queryByRole('status')).toBeNull()
    expect(calls.some(call => call.url.startsWith('/idealize/transcribe'))).toBe(false)
    expect(stopped).toBe(0)
  })

  it('records, transcribes, shows the words, then sends them to the agent it locked onto', async () => {
    installRecorder()
    const calls = installFetch({})
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })

    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('move the plan icon') })

    await waitFor(() => {
      const send = calls.find(call => call.url === '/idealize/comm')
      expect(send).toBeDefined()
      expect(JSON.parse(send!.body as string)).toEqual({ command: 'send', from: 'user', target: 's-nova', body: 'move the plan icon' })
    })
    // The capture crossed as raw samples, never as an audio file.
    const posted = calls.find(call => call.url.startsWith('/idealize/transcribe?'))
    expect(posted?.body).toBeInstanceOf(ArrayBuffer)
    expect(stopped).toBe(1)
  })

  it('puts a transcript nobody can vouch for into the panel instead of sending it', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: { status: 200, body: { text: 'muffled words', confident: false, ms: 5 } } })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)

    await waitFor(() => {
      const panel = view.getByRole('dialog')
      expect(panel.textContent).toContain('Read this back before you send it')
      expect((view.getByPlaceholderText('Ask Nova') as HTMLInputElement).value).toBe('muffled words')
    })
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
  })

  it('says nothing was heard when the capture carried no speech', async () => {
    installRecorder()
    installFetch({ transcribe: { status: 200, body: { text: '', confident: false, ms: 5 } } })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('dialog').textContent).toContain('Nothing was heard') })
  })

  it('reports a refusal in the words the seam used, and sends nothing', async () => {
    installRecorder()
    const calls = installFetch({ transcribe: { status: 422, body: { refusal: 'too-short', message: '120 ms is below the 400 ms floor' } } })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => {
      const card = view.getByRole('status')
      expect(card.textContent).toContain('Nothing was sent')
      expect(card.textContent).toContain('120 ms is below the 400 ms floor')
    })
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
  })

  it('waits out a first-run model fetch, then transcribes the capture it already held', async () => {
    installRecorder()
    let asked = 0
    const calls = installFetch({})
    vi.mocked(fetch).mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: init?.body })
      const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
      if (url.startsWith('/idealize/transcribe/state')) {
        asked += 1
        return json(200, { providers: [], readiness: asked === 1 ? { state: 'preparing', percent: 42 } : { state: 'ready' } })
      }
      if (url.startsWith('/idealize/transcribe/prepare')) return json(200, { readiness: { state: 'ready' } })
      if (url.startsWith('/idealize/transcribe')) {
        return asked === 0
          ? json(503, { refusal: 'not-ready', message: 'local-whisper is not ready' })
          : json(200, { text: 'after the wait', confident: true, ms: 5 })
      }
      if (url === '/idealize/comm') return json(200, { ok: true })
      return json(200, {})
    })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('42%') })
    await waitFor(() => {
      const send = calls.find(call => call.url === '/idealize/comm')
      expect(JSON.parse(send!.body as string)).toMatchObject({ body: 'after the wait' })
    }, { timeout: 4_000 })
  })

  it('keeps the words when the agent could not be reached', async () => {
    installRecorder()
    installFetch({ comm: { ok: false } })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => {
      expect((view.getByPlaceholderText('Ask Nova') as HTMLInputElement).value).toBe('move the plan icon')
    })
  })

  it('Escape while recording releases the microphone and delivers nothing', async () => {
    installRecorder()
    const calls = installFetch({})
    const view = mount()
    await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => { expect(view.queryByRole('status')).toBeNull() })
    expect(stopped).toBe(1)
    expect(calls.some(call => call.url.startsWith('/idealize/transcribe?'))).toBe(false)
  })

  it('says so when the microphone is refused, and when there is none', async () => {
    installRecorder({ deny: true })
    installFetch({})
    const denied = mount()
    await hold(denied)
    await waitFor(() => { expect(denied.getByRole('status').textContent).toContain('the microphone was not allowed') })
    cleanup()

    installRecorder({ noDevice: true })
    const missing = mount()
    await hold(missing)
    await waitFor(() => { expect(missing.getByRole('status').textContent).toContain('no microphone is available') })
  })

  it('says so when this window cannot record at all', async () => {
    installRecorder()
    vi.stubGlobal('MediaRecorder', undefined)
    installFetch({})
    const view = mount()
    await hold(view)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('cannot record audio') })
  })
})

/** A promise a test settles by hand. */
function deferred<T>() {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => { settle = resolve })
  return { promise, settle }
}

describe('a hold that is abandoned part-way', () => {
  it('stops a microphone that opened after the hold was already discarded', async () => {
    installRecorder()
    installFetch({})
    const gate = deferred<true>()
    const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => { await gate.promise; return await media({ audio: true }) } },
    })
    const view = mount()
    await hold(view)
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 20)) })
    // The device that opened late is released, and nothing is on screen.
    expect(stopped).toBe(1)
    expect(view.queryByRole('status')).toBeNull()
  })

  it('drops a transcript that arrives after Escape', async () => {
    installRecorder()
    const calls = installFetch({})
    const gate = deferred<true>()
    const answered = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/idealize/transcribe?')) await gate.promise
      return await answered(input, init)
    })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('Transcribing') })
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
    expect(view.queryByRole('status')).toBeNull()
  })

  it('drops a send that lands after Escape', async () => {
    installRecorder()
    const gate = deferred<true>()
    const calls = installFetch({ comm: { ok: false } })
    const answered = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/idealize/comm') await gate.promise
      return await answered(input, init)
    })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('On its way to Nova') })
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 30)) })
    // The refused send would otherwise open the panel holding the words.
    expect(view.queryByRole('dialog')).toBeNull()
    expect(calls.some(call => call.url === '/idealize/comm')).toBe(true)
  })

  it('says nothing was captured when the recording could not be read', async () => {
    installRecorder()
    installFetch({})
    vi.stubGlobal('AudioContext', class {
      decodeAudioData(): Promise<AudioBuffer> { return Promise.reject(new Error('not audio')) }
      close(): Promise<void> { return Promise.resolve() }
    })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('carried no audio') })
  })
})

describe('waiting for the model', () => {
  /** Answer `not-ready` once, then whatever the state route says. */
  function installPreparing(state: (asked: number) => unknown, options: { stateFails?: boolean } = {}) {
    const calls: { url: string; body?: unknown }[] = []
    let asked = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: init?.body })
      const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
      if (url.startsWith('/idealize/transcribe/state')) {
        if (options.stateFails === true) return Promise.reject(new Error('offline'))
        asked += 1
        return json(200, { providers: [], readiness: state(asked) })
      }
      if (url.startsWith('/idealize/transcribe/prepare')) return json(200, { readiness: { state: 'preparing', percent: 0 } })
      if (url.startsWith('/idealize/transcribe')) return json(503, { refusal: 'not-ready', message: 'not ready' })
      if (url === '/idealize/comm') return json(200, { ok: true })
      return json(200, {})
    }))
    return calls
  }

  it('says why when the provider cannot run at all', async () => {
    installRecorder()
    installPreparing(() => ({ state: 'unavailable', detail: 'no space left on device' }))
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('no space left on device') }, { timeout: 4_000 })
  })

  it('says so when the host goes away while the model is being fetched', async () => {
    installRecorder()
    installPreparing(() => ({ state: 'ready' }), { stateFails: true })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('host could not be reached') }, { timeout: 4_000 })
  })

  it('stops waiting for the model when the hold is discarded', async () => {
    installRecorder()
    const calls = installPreparing(() => ({ state: 'preparing', percent: 5 }))
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('5%') }, { timeout: 4_000 })
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_200)) })
    expect(view.queryByRole('status')).toBeNull()
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
  })
})

describe('Escape lands in every window a hold has', () => {
  it('drops a recording still being decoded', async () => {
    installRecorder()
    const calls = installFetch({})
    const gate = deferred<true>()
    vi.stubGlobal('AudioContext', class {
      async decodeAudioData(): Promise<AudioBuffer> {
        await gate.promise
        const decoded = { duration: 1, sampleRate: 16_000, numberOfChannels: 1, getChannelData: () => new Float32Array(16_000) }
        return decoded as unknown as AudioBuffer
      }
      close(): Promise<void> { return Promise.resolve() }
    })
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(view.getByRole('status').textContent).toContain('Transcribing') })
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 30)) })
    expect(view.queryByRole('status')).toBeNull()
    expect(calls.some(call => call.url.startsWith('/idealize/transcribe?'))).toBe(false)
  })

  it('drops a readiness answer that arrives after the hold is gone', async () => {
    installRecorder()
    const gate = deferred<true>()
    let reached = 0
    const calls: { url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: init?.body })
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.startsWith('/idealize/transcribe/state')) { reached += 1; await gate.promise; return json(200, { providers: [], readiness: { state: 'ready' } }) }
      if (url.startsWith('/idealize/transcribe/prepare')) return json(200, { readiness: { state: 'preparing', percent: 0 } })
      if (url.startsWith('/idealize/transcribe')) return json(503, { refusal: 'not-ready', message: 'not ready' })
      return json(200, { ok: true })
    }))
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    // Escape must land while the readiness read is in flight, not before it starts.
    await waitFor(() => { expect(reached).toBeGreaterThan(0) }, { timeout: 4_000 })
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(view.queryByRole('status')).toBeNull()
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
  })

  it('drops the transcript of a retry that finishes after the hold is gone', async () => {
    installRecorder()
    const gate = deferred<true>()
    let asked = 0
    let transcribes = 0
    const calls: { url: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, body: init?.body })
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
      if (url.startsWith('/idealize/transcribe/state')) { asked += 1; return json(200, { providers: [], readiness: { state: 'ready' } }) }
      if (url.startsWith('/idealize/transcribe/prepare')) return json(200, { readiness: { state: 'ready' } })
      if (url.startsWith('/idealize/transcribe')) {
        transcribes += 1
        if (transcribes === 1) return json(503, { refusal: 'not-ready', message: 'not ready' })
        await gate.promise
        return json(200, { text: 'too late', confident: true, ms: 3 })
      }
      return json(200, { ok: true })
    }))
    const view = mount()
    const chip = await hold(view)
    await waitFor(() => { expect(view.getByLabelText('Nova — Listening')).toBeTruthy() })
    fireEvent.pointerUp(chip)
    await waitFor(() => { expect(transcribes).toBe(2) }, { timeout: 4_000 })
    expect(asked).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => { gate.settle(true); await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(calls.some(call => call.url === '/idealize/comm' && !(typeof call.body === 'string' && call.body.includes('"command":"transcript"')))).toBe(false)
    expect(view.queryByRole('status')).toBeNull()
  })
})
