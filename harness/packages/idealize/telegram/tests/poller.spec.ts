/**
 * The long-poll loop: updates are handled in order past a failing handler,
 * the offset advances, failures back off on the configured delays, and the
 * loop waits for a token when it has none or Telegram rejects it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TelegramApiError, type BotApi, type TelegramUpdate } from '../src/api.ts'
import { Poller, type PollerOptions, type PollerProblem } from '../src/poller.ts'

type Poll = (offset: number, hold: number, signal: AbortSignal) => Promise<TelegramUpdate[]>

/** A poll that holds until the loop is stopped. */
const holdUntilStopped: Poll = (_offset, _hold, signal) => new Promise((_resolve, reject) => {
  signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
})

function bench(polls: Poll[], overrides: Partial<PollerOptions> = {}, realSleep = false) {
  const offsets: number[] = []
  const handled: number[] = []
  const problems: (PollerProblem | undefined)[] = []
  const errors: unknown[] = []
  const sleeps: number[] = []
  const bot = {
    getUpdates: vi.fn((offset: number, hold: number, signal: AbortSignal) => {
      offsets.push(offset)
      return (polls.shift() ?? holdUntilStopped)(offset, hold, signal)
    }),
  } as unknown as BotApi
  const poller = new Poller({
    holdSeconds: 30,
    retryDelaysMs: [5, 20],
    bot: async () => bot,
    onUpdate: async (update) => {
      if (update.update_id === 13) throw new Error('bad update')
      handled.push(update.update_id)
    },
    onProblem: (problem) => { problems.push(problem) },
    onError: (error) => { errors.push(error) },
    ...realSleep ? {} : { sleep: async (ms: number) => { sleeps.push(ms) } },
    ...overrides,
  })
  return { poller, offsets, handled, problems, errors, sleeps, bot }
}

const updates = (...ids: number[]): Poll => async () => ids.map(update_id => ({ update_id }))
const failing = (error: unknown): Poll => async () => { throw error }

/** Let queued promise work settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 5))

let active: Poller | undefined
afterEach(async () => {
  await active?.stop()
  active = undefined
})

describe('Poller', () => {
  it('handles updates in order, moves past a failing handler, and advances the offset', async () => {
    const run = bench([updates(12, 13, 14)])
    active = run.poller
    run.poller.restart()
    await settle()
    expect(run.handled).toEqual([12, 14])
    expect(run.errors).toHaveLength(1)
    expect(run.offsets).toEqual([0, 15])
    expect(run.problems).toEqual([undefined])
  })

  it('stops and reports no token when none is stored', async () => {
    const run = bench([], { bot: async () => undefined })
    run.poller.restart()
    await settle()
    expect(run.problems).toEqual([{ kind: 'no-token' }])
    await run.poller.stop()
  })

  it('stops and reports a rejected token', async () => {
    const run = bench([failing(new TelegramApiError('unauthorized', 'Unauthorized'))])
    run.poller.restart()
    await settle()
    expect(run.problems).toEqual([{ kind: 'unauthorized', message: 'Unauthorized' }])
    expect(run.offsets).toEqual([0])
    await run.poller.stop()
  })

  it('backs off on the configured delays, repeating the last, and clears the problem on success', async () => {
    const run = bench([
      failing(new TelegramApiError('conflict', 'Conflict')),
      failing(new Error('socket hang up')),
      failing(new TelegramApiError('failed', 'getUpdates: Bad Gateway')),
      updates(),
    ])
    active = run.poller
    run.poller.restart()
    await settle()
    expect(run.sleeps).toEqual([5, 20, 20])
    expect(run.problems).toEqual([
      { kind: 'conflict' },
      { kind: 'failed', message: 'Error: socket hang up' },
      { kind: 'failed', message: 'getUpdates: Bad Gateway' },
      undefined,
    ])
  })

  it('waits as long as Telegram asks on a rate limit', async () => {
    const run = bench([
      failing(new TelegramApiError('rate-limited', 'Too Many Requests', 3)),
      failing(new TelegramApiError('rate-limited', 'Too Many Requests')),
    ])
    active = run.poller
    run.poller.restart()
    await settle()
    expect(run.sleeps).toEqual([3000, 1000])
  })

  it('retries at once when no delays are configured', async () => {
    const run = bench([failing(new Error('x'))], { retryDelaysMs: [] })
    active = run.poller
    run.poller.restart()
    await settle()
    expect(run.sleeps).toEqual([0])
  })

  it('unwinds quietly when stopped mid-poll', async () => {
    const run = bench([])
    run.poller.restart()
    await settle()
    await run.poller.stop()
    expect(run.problems).toEqual([])
    expect(run.errors).toEqual([])
  })

  it('does not poll when stopped while the token is being read', async () => {
    let release: (() => void) | undefined
    const run = bench([], {
      bot: () => new Promise((resolve) => {
        release = () => { resolve(run.bot) }
      }),
    })
    run.poller.restart()
    await settle()
    const stopped = run.poller.stop()
    release?.()
    await stopped
    expect(run.offsets).toEqual([])
  })

  it('handles no further updates once stopped mid-batch', async () => {
    const run = bench([updates(1, 2)])
    const handled: number[] = []
    const poller = new Poller({
      holdSeconds: 1,
      retryDelaysMs: [1],
      bot: async () => run.bot,
      onUpdate: async (update) => {
        handled.push(update.update_id)
        // Not awaited: the loop is inside this handler, so it cannot unwind until the handler returns.
        void poller.stop()
      },
      onProblem: () => {},
      onError: () => {},
    })
    poller.restart()
    await settle()
    expect(handled).toEqual([1])
  })

  it('restarts onto a fresh loop and waits for the old one to unwind', async () => {
    const run = bench([])
    active = run.poller
    run.poller.restart()
    await settle()
    run.poller.restart()
    await settle()
    expect(run.offsets).toEqual([0, 0])
  })

  it('sleeps on a real timer that a stop cuts short', async () => {
    const run = bench([failing(new Error('x')), failing(new Error('x'))], { retryDelaysMs: [1, 60_000] }, true)
    run.poller.restart()
    await settle()
    expect(run.offsets).toEqual([0, 0])
    await run.poller.stop()
  })
})
