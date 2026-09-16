/**
 * The relay over the real API proxy approval registry, beside a second mux
 * reader standing in for the app window: a phone answer settles the ask and
 * the window receives the resolution; a window answer edits the phone
 * message, and the phone button then reports the request as gone.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createApiProxy, RpcId, type MuxFrame, type RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { ANSWER_TEXT } from '../src/format.ts'
import type { Keyboard, Messenger } from '../src/ports.ts'
import { Relay } from '../src/relay.ts'

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })

  const sent: { text: string; keyboard?: Keyboard }[] = []
  const edits: { messageId: number; text: string }[] = []
  const answers: { queryId: string; text?: string }[] = []
  const messenger: Messenger = {
    send: async (text, keyboard) => {
      sent.push({ text, ...keyboard === undefined ? {} : { keyboard } })
      return sent.length
    },
    edit: async (messageId, text) => { edits.push({ messageId, text }) },
    typing: async () => {},
    answer: async (queryId, text) => { answers.push({ queryId, ...text === undefined ? {} : { text } }) },
  }
  const relay = new Relay({
    messenger,
    api: () => api,
    nameOf: async () => 'Ada',
    enabled: () => true,
    reopenDelayMs: 10,
    onError: (error) => { throw error },
  })
  relay.restart()
  cleanups.push(() => relay.stop())

  const window = new AbortController()
  const windowFrames: RpcRequest<MuxFrame>[] = []
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: RpcId('window'), payload: {} }, window.signal)) windowFrames.push(envelope)
  })().catch(() => {
    // The window stream ends by abort at teardown; nothing reads its rejection.
  })
  cleanups.push(() => { window.abort() })

  return { ctx, api, relay, sent, edits, answers, windowFrames }
}

function agentOf(ctx: Context): Agent {
  const session = ctx.sessions.create()
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
  expect(check()).toBe(true)
}

describe('the relay over the API proxy', () => {
  it('settles an approval from the phone and the window sees it resolved', async () => {
    const { ctx, relay, sent, edits, answers, windowFrames } = await harness()
    const asked = ctx.approval.request({ agent: agentOf(ctx), toolName: 'bash', reason: 'sandbox escalation' })
    await until(() => sent.length === 1)
    expect(sent[0]?.text).toBe('Ada wants to run bash.\nsandbox escalation')

    await relay.press('cb', 'a:1:y')
    await expect(asked).resolves.toBe('allowed-once')
    expect(answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.allowed }])
    await until(() => windowFrames.some(frame => frame.payload.type === 'approval/resolved'))
    await until(() => edits.length === 1)
    expect(edits[0]).toEqual({ messageId: 1, text: 'Allowed: Ada runs bash.' })
  })

  it('shows the window’s answer on the phone and retires the phone’s buttons', async () => {
    const { ctx, api, relay, sent, edits, answers, windowFrames } = await harness()
    const agent = agentOf(ctx)
    const asked = ctx.approval.request({ agent, toolName: 'bash' })
    await until(() => sent.length === 1 && windowFrames.some(frame => frame.payload.type === 'approval/requested'))
    const requested = windowFrames.find(frame => frame.payload.type === 'approval/requested') as RpcRequest<Extract<MuxFrame, { type: 'approval/requested' }>>

    const receipt = await api.respond({
      type: 'client-response',
      rpcId: requested.rpcId,
      result: { ok: true, value: { sessionId: requested.payload.sessionId, approvalId: requested.payload.approvalId, outcome: 'rejected' } },
    })
    expect(receipt).toEqual({ accepted: true })
    await expect(asked).resolves.toBe('rejected')
    await until(() => edits.length === 1)
    expect(edits[0]).toEqual({ messageId: 1, text: 'Denied: Ada does not run bash.' })

    await relay.press('cb', 'a:1:y')
    expect(answers).toEqual([{ queryId: 'cb', text: ANSWER_TEXT.gone }])
  })
})
