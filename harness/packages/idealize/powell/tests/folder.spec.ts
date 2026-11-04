/**
 * Powell's own folder, over the real session store and log format. A session's
 * working folder decides where its log lives, so the risk in moving Powell is a
 * conversation that no longer resumes. This runs the move across real restarts.
 */

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { oneTurnLog } from '../../../session/session-persistence/tests/contract.ts'
import { apply, Config, POWELL_FOLDER, conversationEnd, type PowellService } from '../src/index.ts'

let base: string
let dataHome: string
let oldHome: string
let contexts: Context[] = []

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'powell-folder-')))
  dataHome = join(base, 'data')
  oldHome = join(base, 'person')
  await mkdir(oldHome, { recursive: true })
  vi.stubEnv('DSH_HOME', dataHome)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
})

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts = []
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(base, { recursive: true, force: true })
})

async function boot(): Promise<{ ctx: Context; powell: PowellService }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root: join(dataHome, 'sessions') })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'test', model: 'fast' }) })
  await ctx.plugin({ name: 'idealize-powell', inject: [], Config, apply })
  // No wait here: an agent asked for straight after boot must still find the stored conversation.
  return { ctx, powell: (ctx as unknown as { get(name: string): PowellService }).get('idealizePowell') }
}

/** Leave a finished conversation on disk in the old folder, and Powell's record pointing at it. */
async function oldConversation(id: string, events: SessionEvent[] = oneTurnLog()): Promise<void> {
  const { ctx } = await boot()
  const handle = await ctx.agents.create({
    sessionId: SessionId(id),
    seed: events,
    meta: { cwd: oldHome, seedLength: events.length },
  })
  await (handle.agent.session as unknown as { flush?: () => Promise<void> }).flush?.()
  await handle.dispose()
  await ctx.fiber.dispose()
  contexts = contexts.filter(other => other !== ctx)
  await mkdir(join(dataHome, 'idealize', 'powell'), { recursive: true })
  await writeFile(join(dataHome, 'idealize', 'powell', 'state.json'), JSON.stringify({ sessionId: id, muted: true }))
}

const stored = async (): Promise<{ sessionId: string; muted?: boolean }> => JSON.parse(await readFile(join(dataHome, 'idealize', 'powell', 'state.json'), 'utf8')) as never

const userText = (agent: Agent): string[] => agent.session.events.flatMap(event =>
  event.type === 'user/message' ? (event.data as { content: { text?: string }[] }).content.map(block => block.text ?? '') : [])

describe.skipIf(process.platform === 'win32')('Powell\'s folder', () => {
  it('starts a new conversation in its own folder inside the data folder, away from home', async () => {
    const { powell } = await boot()
    const agent = await powell.ensureAgent()
    expect(agent.session.header.cwd).toBe(join(dataHome, 'idealize', 'powell', POWELL_FOLDER))
    expect((await stored()).sessionId).toBe(String(agent.session.id))
  })

  it('carries an existing conversation out of the home folder with its history', async () => {
    await oldConversation('session-old')
    const { powell } = await boot()
    const agent = await powell.ensureAgent()
    expect(agent.session.header.cwd).toBe(join(dataHome, 'idealize', 'powell', POWELL_FOLDER))
    expect(String(agent.session.id)).not.toBe('session-old')
    expect(agent.session.header.parentSession).toBe('session-old')
    expect(userText(agent)).toEqual(['hi'])
    const state = await stored()
    expect(state.sessionId).toBe(String(agent.session.id))
    expect(state.muted).toBe(true)
    expect(powell.isPowell(agent.session)).toBe(true)
  })

  it('resumes the moved conversation after another restart, with no second move', async () => {
    await oldConversation('session-old')
    const first = await boot()
    const moved = await first.powell.ensureAgent()
    const movedId = String(moved.session.id)
    await first.ctx.fiber.dispose()
    contexts = contexts.filter(ctx => ctx !== first.ctx)

    const second = await boot()
    const resumed = await second.powell.ensureAgent()
    expect(String(resumed.session.id)).toBe(movedId)
    expect(resumed.session.header.cwd).toBe(join(dataHome, 'idealize', 'powell', POWELL_FOLDER))
    expect(userText(resumed)).toEqual(['hi'])
    expect((await stored()).sessionId).toBe(movedId)
  })

  it('leaves the old log on disk', async () => {
    await oldConversation('session-old')
    const { ctx, powell } = await boot()
    await powell.ensureAgent()
    const persistence = ctx.get('sessionPersistence') as unknown as { locate?: (meta: { id: string; cwd: string }) => { path: string } }
    const old = persistence.locate?.({ id: 'session-old', cwd: oldHome })
    expect(old?.path).toContain('session-old')
    await expect(readFile(old?.path as string)).resolves.toBeDefined()
  })

  it('starts fresh when the old conversation holds nothing to carry', async () => {
    await oldConversation('session-empty', [])
    const { powell } = await boot()
    const agent = await powell.ensureAgent()
    expect(agent.session.header.cwd).toBe(join(dataHome, 'idealize', 'powell', POWELL_FOLDER))
    expect(agent.session.header.parentSession).toBeUndefined()
  })
})

describe('conversationEnd', () => {
  const log = (...types: string[]) => types.map((type, seq) => ({ type, seq }))

  it('cuts after the last finished turn and the standalone events behind it', () => {
    expect(conversationEnd(log('turn/start', 'turn/end', 'session/title', 'turn/start', 'user/message'))).toBe(3)
  })

  it('has nothing to cut without a finished turn', () => {
    expect(conversationEnd(log('turn/start', 'user/message'))).toBeUndefined()
  })
})
