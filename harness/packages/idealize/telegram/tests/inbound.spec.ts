/**
 * The update router: a stranger's chat can only pair, the paired chat's
 * stale messages are refused, text goes to the Studio as a typed post, the
 * commands read and stop agents, and button presses reach the relay or the
 * stop confirmation.
 */

import { describe, expect, it, vi } from 'vitest'
import type { StudioChatPost } from '@idealize/studio'
import type { TelegramUpdate } from '../src/api.ts'
import { HELP_TEXT, INBOUND_TEXT, PAIR_REPLIES } from '../src/format.ts'
import { Inbound } from '../src/inbound.ts'
import type { Keyboard, Messenger, RosterRow, Services } from '../src/ports.ts'

const NOW = 1_800_000_000_000

const roster: RosterRow[] = [
  { id: 's-ada', name: 'Ada', label: 'Landing page', role: 'project-agent', running: true },
  { id: 's-cy', name: 'Cy', label: 'Notes', role: 'chat', running: false },
]

interface BenchOptions {
  paired?: string
  pairedUser?: string
  studio?: boolean
  comm?: boolean
  agents?: boolean
  takeText?: boolean
  press?: boolean
  post?: StudioChatPost
  now?: boolean
}

function bench(options: BenchOptions = {}) {
  const sent: { text: string; keyboard?: Keyboard; chatId?: string }[] = []
  const edits: { messageId: number; text: string }[] = []
  const answers: { queryId: string; text?: string }[] = []
  const posts: { text: string; messageId: string }[] = []
  const cancels: string[] = []
  const claims: { chatId: string; code: string; userId: string; name: string }[] = []
  const typed: number[] = []
  const typing = { start: vi.fn() }
  const messenger: Messenger = {
    send: async (text, keyboard, chatId) => {
      sent.push({ text, ...keyboard === undefined ? {} : { keyboard }, ...chatId === undefined ? {} : { chatId } })
      return 1
    },
    edit: async (messageId, text) => { edits.push({ messageId, text }) },
    typing: async () => { typed.push(1) },
    answer: async (queryId, text) => { answers.push({ queryId, ...text === undefined ? {} : { text } }) },
  }
  const status: Record<string, 'idle' | 'running'> = { 's-ada': 'running', 's-cy': 'idle' }
  const services: Services = {
    studio: () => (options.studio === false ? undefined : {
      postFromChat: async (text, messageId) => {
        posts.push({ text, messageId })
        return options.post ?? { kind: 'delivered', target: 's-bo', project: 'studio', delivery: 'delivered' }
      },
      overview: async () => [],
      state: async () => ({ tasks: [], agents: {}, deliveries: {} }),
    }),
    comm: () => (options.comm === false ? undefined : { roster: async () => roster }),
    agents: () => (options.agents === false ? undefined : {
      get: (id: string) => {
        const current = status[id]
        return current === undefined ? undefined : { status: current, cancel: () => { cancels.push(id) } }
      },
    }),
  }
  const relay = {
    press: vi.fn(async () => options.press === true),
    takeText: vi.fn(async () => options.takeText === true),
    pendingCount: () => 0,
  }
  const inbound = new Inbound({
    messenger,
    typing,
    services,
    relay,
    pairedChat: () => options.paired ?? '42',
    pairedUser: () => options.pairedUser ?? options.paired ?? '42',
    claimPairing: async (claimant, code) => {
      claims.push({ chatId: claimant.chatId, code, userId: claimant.userId, name: claimant.name })
      return 'confirm'
    },
    staleAfterMs: 600_000,
    ...options.now === false ? {} : { now: () => NOW },
  })
  return { inbound, sent, edits, answers, posts, cancels, claims, relay, typing, typed }
}

const message = (text: string | undefined, chat = 42, date = NOW / 1000, from = chat, type = 'private'): TelegramUpdate => ({
  update_id: 1,
  message: { message_id: 7, date, chat: { id: chat, type }, from: { id: from, username: 'jj' }, ...text === undefined ? {} : { text } },
})

/** A button press; `chat: null` models a press whose message Telegram no longer has. */
const press = (data: string | undefined, chat: number | null = 42, from = chat ?? 42): TelegramUpdate => ({
  update_id: 2,
  callback_query: {
    id: 'cb',
    from: { id: from },
    ...data === undefined ? {} : { data },
    ...chat === null ? {} : { message: { message_id: 9, date: NOW / 1000, chat: { id: chat, type: 'private' } } },
  },
})

describe('pairing', () => {
  it('lets any chat try a code and answers that chat', async () => {
    const run = bench({ paired: '' })
    await run.inbound.handle(message('/pair 123456', 99))
    await run.inbound.handle(message('/pair@IdealizeBot 654321', 99))
    expect(run.claims).toEqual([
      { chatId: '99', code: '123456', userId: '99', name: '@jj' },
      { chatId: '99', code: '654321', userId: '99', name: '@jj' },
    ])
    expect(run.sent).toEqual([
      { text: PAIR_REPLIES.confirm, chatId: '99' },
      { text: PAIR_REPLIES.confirm, chatId: '99' },
    ])
  })

  it('refuses a code sent from a group, and does not try it', async () => {
    const run = bench({ paired: '' })
    await run.inbound.handle(message('/pair 123456', -100, NOW / 1000, 7, 'group'))
    await run.inbound.handle(message('/pair 123456', -100, NOW / 1000, 7, 'supergroup'))
    expect(run.claims).toEqual([])
    expect(run.sent).toEqual([
      { text: PAIR_REPLIES['not-private'], chatId: '-100' },
      { text: PAIR_REPLIES['not-private'], chatId: '-100' },
    ])
  })

  it('refuses a code with no sender, which is how a channel post arrives', async () => {
    const run = bench({ paired: '' })
    const post = message('/pair 123456', 99)
    delete (post.message as { from?: unknown }).from
    await run.inbound.handle(post)
    expect(run.claims).toEqual([])
  })

  it('ignores everything else from a chat that is not paired', async () => {
    const unpaired = bench({ paired: '' })
    await unpaired.inbound.handle(message('hello'))
    const stranger = bench()
    await stranger.inbound.handle(message('/status', 99))
    expect([...unpaired.sent, ...stranger.sent, ...unpaired.posts, ...stranger.posts]).toEqual([])
  })
})

describe('someone else in the paired chat', () => {
  it('cannot direct the app by message', async () => {
    const run = bench({ paired: '-100', pairedUser: '42' })
    await run.inbound.handle(message('/stop Ada', -100, NOW / 1000, 666, 'group'))
    await run.inbound.handle(message('delete everything', -100, NOW / 1000, 666, 'group'))
    expect(run.posts).toEqual([])
    expect(run.sent).toEqual([])
    expect(run.relay.takeText).not.toHaveBeenCalled()
  })

  it('cannot press the buttons', async () => {
    const run = bench({ paired: '-100', pairedUser: '42' })
    await run.inbound.handle(press('s:s-ada', -100, 666))
    await run.inbound.handle(press('a:1:y', -100, 666))
    expect(run.cancels).toEqual([])
    expect(run.relay.press).not.toHaveBeenCalled()
  })

  it('leaves the paired person able to', async () => {
    const run = bench({ paired: '-100', pairedUser: '42' })
    await run.inbound.handle(message('hello', -100, NOW / 1000, 42, 'group'))
    expect(run.posts).toHaveLength(1)
  })

  it('obeys nobody when no user is known', async () => {
    const run = bench({ paired: '42', pairedUser: '' })
    await run.inbound.handle(message('hello'))
    expect(run.posts).toEqual([])
  })
})

describe('messages from the paired chat', () => {
  it('posts text to the Studio under a message id stable per Telegram message', async () => {
    const run = bench()
    await run.inbound.handle(message('  what is running?  '))
    expect(run.posts).toEqual([{ text: 'what is running?', messageId: 'telegram-42-7' }])
    expect(run.sent).toEqual([])
  })

  it('starts typing once a post reaches the coordinator, and not when it reaches nobody', async () => {
    const reached = bench()
    await reached.inbound.handle(message('hello'))
    expect(reached.typing.start).toHaveBeenCalledTimes(1)
    const nobody = bench({ post: { kind: 'no-coordinator', reason: 'nobody' } })
    await nobody.inbound.handle(message('hello'))
    expect(nobody.typing.start).not.toHaveBeenCalled()
  })

  it('replies when the post did not reach anyone', async () => {
    const run = bench({ post: { kind: 'unresolved', token: 'Zed', names: ['Ada'] } })
    await run.inbound.handle(message('@Zed hi'))
    expect(run.sent).toEqual([{ text: 'Nobody called @Zed is here. Try one of: Ada.' }])
  })

  it('says so when the Studio is absent', async () => {
    const run = bench({ studio: false })
    await run.inbound.handle(message('hi'))
    expect(run.sent).toEqual([{ text: INBOUND_TEXT.noStudio }])
  })

  it('refuses a message sent while the app was closed', async () => {
    const run = bench()
    await run.inbound.handle(message('stop everything', 42, NOW / 1000 - 601))
    expect(run.sent).toEqual([{ text: INBOUND_TEXT.stale }])
    expect(run.posts).toEqual([])
  })

  it('reads the clock itself when none is given', async () => {
    const run = bench({ now: false })
    await run.inbound.handle(message('hi', 42, Math.floor(Date.now() / 1000)))
    expect(run.posts).toHaveLength(1)
  })

  it('gives the text to a question waiting for it instead of the Studio', async () => {
    const run = bench({ takeText: true })
    await run.inbound.handle(message('Serif, please'))
    expect(run.relay.takeText).toHaveBeenCalledWith('Serif, please')
    expect(run.posts).toEqual([])
  })

  it('ignores updates with no text and updates of other kinds', async () => {
    const run = bench()
    await run.inbound.handle(message(undefined))
    await run.inbound.handle({ update_id: 3 })
    expect([...run.sent, ...run.posts]).toEqual([])
  })
})

describe('commands', () => {
  it('answers /status and /agents, with or without the Studio and comm', async () => {
    const run = bench()
    await run.inbound.handle(message('/status'))
    await run.inbound.handle(message('/agents'))
    const bare = bench({ studio: false, comm: false })
    await bare.inbound.handle(message('/status'))
    await bare.inbound.handle(message('/agents'))
    expect(run.sent.map(entry => entry.text)).toEqual([
      'Running: Ada.\n\nNo open tasks.',
      '• Ada (Landing page): running\n• Cy (Notes): idle',
    ])
    expect(bare.sent.map(entry => entry.text)).toEqual(['Nothing is running.\n\nNo open tasks.', 'No agents yet.'])
  })

  it('answers /help, /start and unknown commands with the help text', async () => {
    const run = bench()
    await run.inbound.handle(message('/help'))
    await run.inbound.handle(message('/start'))
    await run.inbound.handle(message('/dance now'))
    expect(run.sent.map(entry => entry.text)).toEqual([HELP_TEXT, HELP_TEXT, HELP_TEXT])
  })

  it('asks who to stop, explains a name that matches nobody, and refuses an idle agent', async () => {
    const run = bench()
    await run.inbound.handle(message('/stop'))
    await run.inbound.handle(message('/stop Zed'))
    await run.inbound.handle(message('/stop cy'))
    expect(run.sent.map(entry => entry.text)).toEqual([INBOUND_TEXT.stopWho, "no session matching 'Zed'", 'Cy is not running.'])
  })

  it('treats an agent as not running when the registry is absent', async () => {
    const run = bench({ agents: false })
    await run.inbound.handle(message('/stop Ada'))
    expect(run.sent.map(entry => entry.text)).toEqual(['Ada is not running.'])
  })

  it('confirms before stopping a running agent', async () => {
    const run = bench()
    await run.inbound.handle(message('/stop Ada'))
    expect(run.sent).toEqual([{
      text: 'Stop Ada? It keeps its queued messages.',
      keyboard: [[{ text: 'Stop', data: 's:s-ada' }, { text: 'Keep running', data: 'k' }]],
    }])
    expect(run.cancels).toEqual([])
  })
})

describe('button presses', () => {
  it('stops the agent on Stop, keeping its queue', async () => {
    const run = bench()
    await run.inbound.handle(press('s:s-ada'))
    expect(run.cancels).toEqual(['s-ada'])
    expect(run.answers).toEqual([{ queryId: 'cb' }])
    expect(run.edits).toEqual([{ messageId: 9, text: 'Stopped Ada.' }])
  })

  it('reports an agent that went idle before Stop was pressed', async () => {
    const run = bench()
    await run.inbound.handle(press('s:s-cy'))
    expect(run.cancels).toEqual([])
    expect(run.edits).toEqual([{ messageId: 9, text: 'Cy is not running.' }])
  })

  it('leaves the agent running on Keep running', async () => {
    const run = bench()
    await run.inbound.handle(press('k'))
    expect(run.answers).toEqual([{ queryId: 'cb' }])
    expect(run.edits).toEqual([{ messageId: 9, text: INBOUND_TEXT.keptRunning }])
  })

  it('hands relay buttons to the relay', async () => {
    const run = bench({ press: true })
    await run.inbound.handle(press('a:1:y'))
    expect(run.relay.press).toHaveBeenCalledWith('cb', 'a:1:y')
    expect(run.answers).toEqual([])
  })

  it('only acknowledges unknown buttons and presses from anywhere but the paired chat', async () => {
    const run = bench()
    await run.inbound.handle(press('zzz'))
    await run.inbound.handle(press(undefined))
    await run.inbound.handle(press('s:s-ada', 99))
    await run.inbound.handle(press('s:s-ada', null))
    const unpaired = bench({ paired: '' })
    await unpaired.inbound.handle(press('s:s-ada'))
    expect(run.relay.press.mock.calls).toEqual([['cb', 'zzz'], ['cb', '']])
    expect(run.answers).toHaveLength(4)
    expect(unpaired.answers).toHaveLength(1)
    expect([...run.cancels, ...unpaired.cancels]).toEqual([])
  })
})
