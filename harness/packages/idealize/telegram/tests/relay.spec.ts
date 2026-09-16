/**
 * The approvals relay against a scripted mux stream: each pending approval or
 * question reaches the phone once, a press answers through `respond`, an
 * answer the app already gave is reported as such, resolved frames edit the
 * phone message, and the stream reopens after it ends.
 */

import { describe, expect, it, vi } from 'vitest'
import { RpcId, type MuxFrame, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'
import { ANSWER_TEXT } from '../src/format.ts'
import type { Keyboard, Messenger } from '../src/ports.ts'
import { Relay, type ApiProxyPort, type RelayOptions } from '../src/relay.ts'

type Mux = (signal: AbortSignal) => AsyncIterable<RpcRequest<MuxFrame>>

interface Flags {
  enabled: boolean
  accept: boolean
  unsent: boolean
  api: boolean
  sendThrows: boolean
}

function bench(flagsIn: Partial<Flags> = {}, mux?: Mux, overrides: Partial<RelayOptions> = {}, realSleep = false) {
  const flags: Flags = { enabled: true, accept: true, unsent: false, api: true, sendThrows: false, ...flagsIn }
  const sent: { text: string; keyboard?: Keyboard }[] = []
  const edits: { messageId: number; text: string; keyboard?: Keyboard }[] = []
  const answers: { queryId: string; text?: string }[] = []
  const errors: unknown[] = []
  const sleeps: number[] = []
  let nextId = 100
  const messenger: Messenger = {
    send: async (text, keyboard) => {
      if (flags.sendThrows) throw new Error('send failed')
      sent.push({ text, ...keyboard === undefined ? {} : { keyboard } })
      if (flags.unsent) return undefined
      nextId += 1
      return nextId
    },
    edit: async (messageId, text, keyboard) => { edits.push({ messageId, text, ...keyboard === undefined ? {} : { keyboard } }) },
    typing: async () => {},
    answer: async (queryId, text) => { answers.push({ queryId, ...text === undefined ? {} : { text } }) },
  }
  const respond = vi.fn(async () => (flags.accept ? { accepted: true } : { accepted: false, reason: 'not-pending' }))
  const opens = vi.fn((_request: unknown, signal: AbortSignal) => (mux ?? held())(signal))
  const api = { events: { mux: opens }, respond } as unknown as ApiProxyPort
  const relay = new Relay({
    messenger,
    api: () => (flags.api ? api : undefined),
    nameOf: async id => `name-${id}`,
    enabled: () => flags.enabled,
    reopenDelayMs: 1,
    onError: (error) => { errors.push(error) },
    ...realSleep ? {} : { sleep: async (ms: number) => { sleeps.push(ms) } },
    ...overrides,
  })
  return { relay, flags, sent, edits, answers, errors, respond, opens, sleeps }
}

/** A stream that yields its frames and then holds until the relay stops. */
function held(frames: RpcRequest<MuxFrame>[] = []): Mux {
  return signal => (async function* () {
    yield* frames
    await new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
  })()
}

const envelope = (rpcId: string, payload: Record<string, unknown>): RpcRequest<MuxFrame> =>
  ({ rpcId: RpcId(rpcId), payload: payload as unknown as MuxFrame })

const approval = envelope('r-1', { type: 'approval/requested', sessionId: 's1', approvalId: 'ap-1', toolName: 'bash', reason: 'escalation' })
const approvalResolved = (outcome: string) => envelope('push', { type: 'approval/resolved', sessionId: 's1', approvalId: 'ap-1', outcome })
const fontQuestion = envelope('rq-1', {
  type: 'question/requested', sessionId: 's1',
  questions: [{ id: 'font', question: 'Which font?', options: [{ label: 'Serif' }, { label: 'Sans' }] }],
})
const questionResolved = (outcome: string) => envelope('push', { type: 'question/resolved', sessionId: 's1', questionRpcId: 'rq-1', outcome })

const settle = () => new Promise(resolve => setTimeout(resolve, 5))

describe('approvals', () => {
  it('sends each pending approval once with Allow and Deny', async () => {
    const run = bench()
    await run.relay.handle(approval)
    await run.relay.handle(approval)
    expect(run.sent).toEqual([{
      text: 'name-s1 wants to run bash.\nescalation',
      keyboard: [[{ text: 'Allow once', data: 'a:1:y' }, { text: 'Deny', data: 'a:1:n' }]],
    }])
    expect(run.relay.pendingCount()).toBe(1)
  })

  it('allows through respond, then shows the outcome the resolved frame carries', async () => {
    const run = bench()
    await run.relay.handle(approval)
    await expect(run.relay.press('cb', 'a:1:y')).resolves.toBe(true)
    expect(run.respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: 'r-1',
      result: { ok: true, value: { sessionId: 's1', approvalId: 'ap-1', outcome: 'allowed-once' } },
    })
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.allowed }])
    await run.relay.handle(approvalResolved('allowed-once'))
    expect(run.edits).toEqual([{ messageId: 101, text: 'Allowed: name-s1 runs bash.' }])
    expect(run.relay.pendingCount()).toBe(0)
    await run.relay.press('cb2', 'a:1:y')
    expect(run.answers.at(-1)).toEqual({ queryId: 'cb2', text: ANSWER_TEXT.gone })
  })

  it('denies through respond', async () => {
    const run = bench()
    await run.relay.handle(approval)
    await run.relay.press('cb', 'a:1:n')
    expect(run.respond.mock.calls[0]).toMatchObject([{ result: { value: { outcome: 'rejected' } } }])
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.denied }])
  })

  it('says the app answered first when respond no longer has the request', async () => {
    const run = bench({ accept: false })
    await run.relay.handle(approval)
    await run.relay.press('cb', 'a:1:y')
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.already }])
    expect(run.edits).toEqual([{ messageId: 101, text: ANSWER_TEXT.already }])
    expect(run.relay.pendingCount()).toBe(0)
  })

  it('treats a missing API proxy at press time as already answered', async () => {
    const run = bench()
    await run.relay.handle(approval)
    run.flags.api = false
    await run.relay.press('cb', 'a:1:y')
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.already }])
  })

  it('sends nothing while forwarding is off, and offers again once a send lands', async () => {
    const run = bench({ enabled: false })
    await run.relay.handle(approval)
    expect(run.sent).toEqual([])
    run.flags.enabled = true
    run.flags.unsent = true
    await run.relay.handle(approval)
    expect(run.relay.pendingCount()).toBe(0)
    run.flags.unsent = false
    await run.relay.handle(approval)
    expect(run.relay.pendingCount()).toBe(1)
  })

  it('ignores a resolution it never sent, foreign buttons, and frames of other kinds', async () => {
    const run = bench()
    await run.relay.handle(approvalResolved('rejected'))
    await run.relay.handle(questionResolved('answered'))
    await run.relay.handle(envelope('x', { type: 'session/queue', sessionId: 's1', items: [] }))
    await expect(run.relay.press('cb', 's:s1')).resolves.toBe(false)
    expect([...run.sent, ...run.edits, ...run.answers]).toEqual([])
  })

  it('answers "no longer waiting" for an unknown id or a button of the wrong kind', async () => {
    const run = bench()
    await run.relay.handle(approval)
    await run.relay.press('cb1', 'a:zz:y')
    await run.relay.press('cb2', 'q:1:0')
    expect(run.answers).toEqual([{ queryId: 'cb1', text: ANSWER_TEXT.gone }, { queryId: 'cb2', text: ANSWER_TEXT.gone }])
    expect(run.respond).not.toHaveBeenCalled()
  })

  it('keeps other pending approvals when one settles', async () => {
    const run = bench()
    const second = envelope('r-2', { type: 'approval/requested', sessionId: 's2', approvalId: 'ap-2', toolName: 'write' })
    await run.relay.handle(approval)
    await run.relay.handle(second)
    await run.relay.handle(approvalResolved('rejected'))
    expect(run.relay.pendingCount()).toBe(1)
    await run.relay.handle(second)
    expect(run.sent).toHaveLength(2)
  })

  it('reports a failed send', async () => {
    const run = bench({ sendThrows: true })
    await run.relay.handle(approval)
    expect(run.errors).toHaveLength(1)
  })
})

describe('questions', () => {
  it('answers a single-select question on tap and shows the resolution', async () => {
    const run = bench()
    await run.relay.handle(fontQuestion)
    await run.relay.handle(fontQuestion)
    expect(run.sent).toHaveLength(1)
    await run.relay.press('cb', 'q:1:1')
    expect(run.answers).toEqual([{ queryId: 'cb' }])
    expect(run.respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: 'rq-1',
      result: { ok: true, value: { sessionId: 's1', answer: { answers: [{ id: 'font', selected: ['Sans'] }] } } },
    })
    await run.relay.handle(questionResolved('answered'))
    expect(run.edits.at(-1)).toEqual({ messageId: 101, text: ANSWER_TEXT.answered })
    expect(run.relay.pendingCount()).toBe(0)
  })

  it('shows a withdrawn question as withdrawn', async () => {
    const run = bench()
    await run.relay.handle(fontQuestion)
    await run.relay.handle(questionResolved('cancelled'))
    expect(run.edits).toEqual([{ messageId: 101, text: ANSWER_TEXT.cancelled }])
  })

  it('ticks options, moves to the next question on Done, and takes typed text for an option-less one', async () => {
    const run = bench()
    await run.relay.handle(envelope('rq-2', {
      type: 'question/requested', sessionId: 's1',
      questions: [
        { id: 'pages', question: 'Which pages?', multiSelect: true, options: [{ label: 'Home' }, { label: 'About' }] },
        { id: 'note', question: 'Anything else?' },
      ],
    }))
    await run.relay.press('c1', 'q:1:0')
    await run.relay.press('c2', 'q:1:1')
    await run.relay.press('c3', 'q:1:0')
    expect(run.edits.at(-1)?.keyboard).toEqual([
      [{ text: 'Home', data: 'q:1:0' }],
      [{ text: '✓ About', data: 'q:1:1' }],
      [{ text: 'Other (type it)', data: 'q:1:other' }, { text: 'Done', data: 'q:1:done' }],
    ])
    await run.relay.press('c4', 'q:1:done')
    expect(run.edits.at(-1)).toEqual({ messageId: 101, text: 'name-s1 asks (2 of 2):\nAnything else?\nReply with your answer.', keyboard: [] })
    await expect(run.relay.takeText('Ship it')).resolves.toBe(true)
    expect(run.respond).toHaveBeenCalledWith({
      type: 'client-response', rpcId: 'rq-2',
      result: { ok: true, value: { sessionId: 's1', answer: { answers: [
        { id: 'pages', selected: ['About'] },
        { id: 'note', selected: [], custom: 'Ship it' },
      ] } } },
    })
  })

  it('takes Other as typed text alongside ticked options', async () => {
    const run = bench()
    await run.relay.handle(envelope('rq-3', {
      type: 'question/requested', sessionId: 's1',
      questions: [{ id: 'pages', question: 'Which pages?', multiSelect: true, options: [{ label: 'Home' }] }],
    }))
    await run.relay.press('c1', 'q:1:0')
    await run.relay.press('c2', 'q:1:other')
    expect(run.answers.at(-1)).toEqual({ queryId: 'c2', text: ANSWER_TEXT.typeIt })
    await run.relay.takeText('Blog')
    expect(run.respond.mock.calls[0]).toMatchObject([{ result: { value: { answer: { answers: [{ id: 'pages', selected: ['Home'], custom: 'Blog' }] } } } }])
  })

  it('takes Other on a single-select question with no ticked options', async () => {
    const run = bench()
    await run.relay.handle(fontQuestion)
    await run.relay.press('c1', 'q:1:other')
    await run.relay.takeText('Mono')
    expect(run.respond.mock.calls[0]).toMatchObject([{ result: { value: { answer: { answers: [{ id: 'font', selected: [], custom: 'Mono' }] } } } }])
  })

  it('reports the app answered first when the answers are no longer wanted', async () => {
    const run = bench({ accept: false })
    await run.relay.handle(fontQuestion)
    await run.relay.press('cb', 'q:1:0')
    expect(run.edits).toEqual([{ messageId: 101, text: ANSWER_TEXT.already }])
    expect(run.relay.pendingCount()).toBe(0)
  })

  it('refuses an option that does not exist and text nobody waits for', async () => {
    const run = bench()
    await run.relay.handle(fontQuestion)
    await run.relay.press('cb', 'q:1:9')
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.gone }])
    await expect(run.relay.takeText('hello')).resolves.toBe(false)
  })

  it('takes typed text for a question with no options and refuses a numbered press on it', async () => {
    const run = bench()
    await run.relay.handle(envelope('rq-4', { type: 'question/requested', sessionId: 's1', questions: [{ id: 'note', question: 'What should it say?' }] }))
    expect(run.sent[0]?.keyboard).toEqual([])
    await run.relay.press('cb', 'q:1:0')
    expect(run.answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.gone }])
    await run.relay.takeText('Hello there')
    expect(run.respond.mock.calls[0]).toMatchObject([{ result: { value: { answer: { answers: [{ id: 'note', selected: [], custom: 'Hello there' }] } } } }])
  })

  it('skips an empty request, a request while forwarding is off, and forgets one it could not send', async () => {
    const run = bench({ enabled: false })
    await run.relay.handle(fontQuestion)
    run.flags.enabled = true
    await run.relay.handle(envelope('rq-9', { type: 'question/requested', sessionId: 's1', questions: [] }))
    run.flags.unsent = true
    await run.relay.handle(fontQuestion)
    expect(run.relay.pendingCount()).toBe(0)
    expect(run.sent).toHaveLength(1)
  })

  it('ignores a question resolution while the id belongs to an approval', async () => {
    const run = bench()
    await run.relay.handle(approval)
    await run.relay.handle(envelope('push', { type: 'question/resolved', sessionId: 's1', questionRpcId: 'r-1', outcome: 'answered' }))
    await run.relay.handle(envelope('push', { type: 'approval/resolved', sessionId: 's1', approvalId: 'ap-x', outcome: 'rejected' }))
    expect(run.relay.pendingCount()).toBe(1)
  })
})

describe('the stream', () => {
  it('does nothing without an API proxy', async () => {
    const run = bench({ api: false })
    run.relay.restart()
    await settle()
    await run.relay.stop()
    expect(run.opens).not.toHaveBeenCalled()
  })

  it('reopens after the stream ends and skips requests it already sent', async () => {
    let count = 0
    const run = bench({}, (signal) => {
      count += 1
      if (count === 1) return (async function* () { yield approval })()
      return held([approval])(signal)
    })
    run.relay.restart()
    await settle()
    expect(run.opens).toHaveBeenCalledTimes(2)
    expect(run.sleeps).toEqual([1])
    expect(run.sent).toHaveLength(1)
    await run.relay.stop()
    expect(run.errors).toEqual([])
  })

  it('reports a failed stream and reopens it', async () => {
    let count = 0
    const run = bench({}, (signal) => {
      count += 1
      if (count === 1) return (async function* () { yield* []; throw new Error('stream broke') })()
      return held()(signal)
    })
    run.relay.restart()
    await settle()
    expect(run.errors).toHaveLength(1)
    await run.relay.stop()
  })

  it('restarts onto a fresh stream', async () => {
    const run = bench()
    run.relay.restart()
    await settle()
    run.relay.restart()
    await settle()
    expect(run.opens).toHaveBeenCalledTimes(2)
    await run.relay.stop()
  })

  it('waits on a real timer between opens, cut short by a stop', async () => {
    const ends: Mux = () => (async function* () { yield* [] })()
    const quick = bench({}, ends, { reopenDelayMs: 1 }, true)
    quick.relay.restart()
    await settle()
    await quick.relay.stop()
    expect(quick.opens.mock.calls.length).toBeGreaterThan(1)
    const slow = bench({}, ends, { reopenDelayMs: 60_000 }, true)
    slow.relay.restart()
    await settle()
    await slow.relay.stop()
    expect(slow.opens).toHaveBeenCalledTimes(1)
  })
})
