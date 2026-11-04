/**
 * The clean-up runs against a real session store holding a planted example of
 * every kind of chat. A chat only moves when everything agrees it was never
 * used, so most of these examples prove something stays.
 */

import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { logSaysBlank, setAsideBlankChats, terminalConversationId, type BlankChatStore } from '../src/blank-chats.ts'

const NOW = Date.UTC(2026, 10, 4, 12)
const DAY = 86_400_000
const OLD = NOW - 3 * DAY

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** The events a real new chat wrote, read from a log on blank data. */
const opening = (space: string | null = 'chat'): Array<Record<string, unknown>> => [
  { type: 'permission/preset', data: { preset: 'workspace-write' } },
  { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
  { type: 'approval/policy', data: { policy: 'ask' } },
  { type: 'idealize/agent-name', data: { name: 'Jar Jar Binks', pool: 0 }, ignorable: true },
  { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [{
    content: [{ type: 'text', text: 'Your name in IDEalize is Jar Jar Binks.' }],
    source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: 'Agent name' },
  }] } },
  { type: 'agent-preset/selected', data: { agentPreset: 'coding' } },
  ...space === null ? [] : [{ type: 'idealize/space', data: { space }, ignorable: true }],
  { type: 'idealize/brain', data: { brain: 'coding' }, ignorable: true },
]

const prompt = { type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{
  content: [{ type: 'text', text: 'Make me a poster' }],
  source: { kind: 'user', rpcId: 'r1' },
}] } }

const peerNote = { type: 'agent/inbox/spliced', data: { target: 'next-step', start: 0, inserted: [{
  content: [{ type: 'text', text: 'Here is the plan' }],
  source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: 'Note from Yoda' },
}] } }

interface Bench {
  ctx: Context
  store: BlankChatStore & JsonlSessionPersistence
  root: string
  home: string
  userHome: string
}

async function bench(): Promise<Bench> {
  const top = await mkdtemp(join(tmpdir(), 'idealize-blank-chats-'))
  roots.push(top)
  const root = join(top, 'sessions')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root })
  return {
    ctx,
    store: (ctx as unknown as { sessionPersistence: BlankChatStore & JsonlSessionPersistence }).sessionPersistence,
    root,
    home: join(top, 'home'),
    userHome: join(top, 'user'),
  }
}

async function plant(
  b: Bench,
  id: string,
  events: ReadonlyArray<Record<string, unknown>>,
  header: Partial<SessionHeader> = {},
  touchedAt: number = OLD,
): Promise<string> {
  const meta: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: OLD, cwd: '/tmp/project', ...header }
  await b.store.create(meta)
  await b.store.append(meta.id, events.map((event, seq) => ({ ...event, seq, time: OLD + seq })) as SessionEvent[])
  const path = b.store.locate(meta)!.path
  await utimes(path, new Date(touchedAt), new Date(touchedAt))
  return path
}

const sweep = async (b: Bench, isLive: (id: SessionId) => boolean = () => false): Promise<string[] | undefined> =>
  await setAsideBlankChats({ store: b.store, isLive, home: b.home, userHome: b.userHome, claudeDir: join(b.userHome, '.claude'), now: NOW, log: () => {} })

const FOLDER = '.blank-chats-2026-11-04'

describe('setting blank chats aside', () => {
  it('moves a blank Chat chat whole, erases nothing, and moving it back restores it', async () => {
    const b = await bench()
    const path = await plant(b, 'blank', opening())
    const before = await readFile(path)
    expect(await sweep(b)).toEqual(['blank'])

    const to = join(b.root, FOLDER, basename(dirname(dirname(path))), basename(dirname(path)), basename(path))
    expect((await readFile(to)).equals(before)).toBe(true)
    await expect(stat(path)).rejects.toThrow()
    expect(await b.store.list()).toEqual([])

    await mkdir(dirname(dirname(path)), { recursive: true })
    await rename(dirname(to), dirname(path))
    expect((await b.store.list()).map(header => String(header.id))).toEqual(['blank'])
    expect((await b.store.readFrom(SessionId('blank'), 0)).events).toHaveLength(opening().length)
  })

  it('moves a blank chat with no space on record, once spaces were being recorded', async () => {
    const b = await bench()
    await plant(b, 'no-space', opening(null))
    expect(await sweep(b)).toEqual(['no-space'])
  })

  const kept: Array<[string, ReadonlyArray<Record<string, unknown>>, Partial<SessionHeader>?]> = [
    ['a Terminal chat, whose prompts never reach its log', opening('terminal')],
    ['a Studio chat', opening('studio')],
    ['a Gallery chat', opening('gallery')],
    ['a Sound Stage chat', opening('soundstage')],
    ['a Motion chat', opening('motion')],
    ['a chat that moved to the Terminal and back', [...opening('terminal'), { type: 'idealize/space', data: { space: 'chat' }, ignorable: true }]],
    ['a chat on a media preset', opening(), { agentPreset: 'gallery' }],
    ['a chat with a title', [...opening(), { type: 'session/title', data: { title: 'Poster', messageSeqs: [], source: { kind: 'user' } } }]],
    ['a chat with a prompt waiting', [...opening(), prompt]],
    ['a chat with a turn', [...opening(), { type: 'turn/start', data: { turn: 1 } }]],
    ['a chat holding a note from another chat', [...opening(), peerNote]],
    ['a chat with an event this does not know', [...opening(), { type: 'idealize/something-new', data: {}, ignorable: true }]],
    ['a chat from before spaces were recorded', opening(null), { createdAt: Date.UTC(2026, 7, 20) }],
    ['a child of another chat', opening(), { parentSession: SessionId('someone') }],
    ['a subagent', opening(), { origin: 'subagent', delegationDepth: 1 }],
    ['a chat under a day old', opening(), { createdAt: NOW - DAY / 2 }],
  ]
  for (const [name, events, header] of kept) {
    it(`keeps ${name}`, async () => {
      const b = await bench()
      const path = await plant(b, 'kept', events, header)
      expect(await sweep(b)).toEqual([])
      expect((await stat(path)).isFile()).toBe(true)
    })
  }

  it('keeps a chat touched within the last day, however old it is', async () => {
    const b = await bench()
    await plant(b, 'touched', opening(), {}, NOW - DAY / 2)
    expect(await sweep(b)).toEqual([])
  })

  it('keeps a chat with anything beside its log', async () => {
    const b = await bench()
    const path = await plant(b, 'beside', opening())
    await writeFile(join(dirname(path), 'extra.txt'), 'x')
    expect(await sweep(b)).toEqual([])
  })

  it('keeps a chat that is open', async () => {
    const b = await bench()
    await plant(b, 'open', opening())
    expect(await sweep(b, id => String(id) === 'open')).toEqual([])
  })

  it('keeps a chat another chat was forked from', async () => {
    const b = await bench()
    await plant(b, 'parent', opening())
    await plant(b, 'child', [...opening(), prompt], { parentSession: SessionId('parent') })
    expect(await sweep(b)).toEqual([])
  })

  it('keeps a Chat chat whose Terminal face holds a Claude Code conversation', async () => {
    const b = await bench()
    await plant(b, 'toggled', opening())
    const folder = join(b.userHome, '.claude', 'projects', '-tmp-project')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${terminalConversationId('toggled', 'claude')}.jsonl`), '{}\n')
    expect(await sweep(b)).toEqual([])
  })

  it('keeps a Chat chat whose Terminal face holds a Pi conversation', async () => {
    const b = await bench()
    await plant(b, 'toggled-pi', opening())
    const folder = join(b.userHome, '.pi', 'agent', 'sessions', '--tmp-project--')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `2026-10-01T10-00-00_${terminalConversationId('toggled-pi', 'pi')}.jsonl`), '{}\n')
    expect(await sweep(b)).toEqual([])
  })

  it('keeps a Chat chat whose Terminal is still running', async () => {
    const b = await bench()
    await plant(b, 'running', opening())
    await mkdir(join(b.home, 'idealize', 'terminal-knowledge'), { recursive: true })
    await writeFile(join(b.home, 'idealize', 'terminal-knowledge', 'running.md'), 'rules')
    expect(await sweep(b)).toEqual([])
  })

  it('leaves a chat it cannot read where it is and carries on', async () => {
    const b = await bench()
    const path = await plant(b, 'damaged', opening())
    await plant(b, 'fine', opening())
    const store = Object.create(b.store) as BlankChatStore
    store.readFrom = async (id, from) => {
      if (String(id) === 'damaged') throw new Error('corrupt')
      return await b.store.readFrom(id, from)
    }
    const moved = await setAsideBlankChats({ store, isLive: () => false, home: b.home, userHome: b.userHome, now: NOW, log: () => {} })
    expect(moved).toEqual(['fine'])
    expect((await stat(path)).isFile()).toBe(true)
  })

  it('runs once: a chat that goes blank and old later stays', async () => {
    const b = await bench()
    await plant(b, 'first', opening())
    expect(await sweep(b)).toEqual(['first'])
    await plant(b, 'second', opening())
    expect(await sweep(b)).toBeUndefined()
    expect((await b.store.list()).map(header => String(header.id))).toEqual(['second'])
    expect(JSON.parse(await readFile(join(b.home, 'idealize', 'blank-chats-set-aside.json'), 'utf8'))).toMatchObject({ folder: FOLDER, moved: ['first'] })
  })

  it('leaves the listing and the folder layout readable after a move', async () => {
    const b = await bench()
    await plant(b, 'gone', opening())
    await plant(b, 'stays', [...opening(), prompt])
    await sweep(b)
    expect((await b.store.list()).map(header => String(header.id))).toEqual(['stays'])
    expect((await readdir(b.root)).sort()).toContain(FOLDER)
  })
})

describe('what a blank log looks like', () => {
  const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id: SessionId('x'), createdAt: OLD }
  const asEvents = (events: ReadonlyArray<Record<string, unknown>>): SessionEvent[] => events as unknown as SessionEvent[]

  it('treats an absent delegation depth as top level', () => {
    expect(logSaysBlank({ header, events: asEvents(opening()) }, NOW)).toBe(true)
  })

  it('reads a real user message as use', () => {
    expect(logSaysBlank({ header, events: asEvents([...opening(), { type: 'user/message', data: {} }]) }, NOW)).toBe(false)
  })
})

describe('the Terminal conversation id', () => {
  it('stays equal to the one the Terminal itself uses', async () => {
    // Read by address: this package may not depend on the Terminal's.
    const terminal = new URL('../../ui-terminal/src/conversation.ts', import.meta.url).href
    const { conversationId } = await import(/* @vite-ignore */ terminal) as { conversationId: (chat: string, program: string) => string }
    for (const [chat, program] of [['session-abc', 'claude'], ['x', 'pi'], ['üñí', 'claude']] as const) {
      expect(terminalConversationId(chat, program)).toBe(conversationId(chat, program))
    }
  })
})
