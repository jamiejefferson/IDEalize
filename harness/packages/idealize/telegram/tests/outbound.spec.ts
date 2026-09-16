/**
 * What reaches the phone unasked: coordinator posts, task endings on project
 * timelines, attention alerts and agent errors, each behind its toggle, and
 * never the person's own posts or every idle flip.
 */

import { describe, expect, it, vi } from 'vitest'
import type { BridgeEvent } from '@idealize/host-bridge'
import type { StudioEvent, StudioState } from '@idealize/studio'
import { Outbound } from '../src/outbound.ts'
import type { Messenger, RosterRow, Services } from '../src/ports.ts'
import { TELEGRAM_DEFAULTS, type TelegramSettings } from '../src/settings.ts'

const roster: RosterRow[] = [{ id: 's-bo', name: 'Bo', label: 'Studio', role: 'studio-agent', running: true }]

function bench(settings: Partial<TelegramSettings> = {}, options: { comm?: boolean; studio?: boolean } = {}) {
  const sent: string[] = []
  const typed: number[] = []
  const typing = { stop: vi.fn() }
  const messenger: Messenger = {
    send: async (text) => { sent.push(text); return 1 },
    edit: async () => {},
    typing: async () => { typed.push(1) },
    answer: async () => {},
  }
  const state = { tasks: [{ id: 't1', goal: 'Hero copy' }] } as unknown as StudioState
  const services: Services = {
    studio: () => (options.studio === false ? undefined : { state: async () => state } as never),
    comm: () => (options.comm === false ? undefined : { roster: async () => roster }),
    agents: () => undefined,
  }
  const outbound = new Outbound({ messenger, services, typing, settings: () => ({ ...TELEGRAM_DEFAULTS, chatId: '42', ...settings }) })
  return { outbound, sent, typing }
}

const event = (over: Partial<StudioEvent>): StudioEvent =>
  ({ id: 'e1', seq: 1, at: '2026-09-13T10:00:00Z', visibility: 'studio', project: 'studio', author: 's-bo', kind: 'message', ...over }) as StudioEvent

const bridge = (over: Partial<BridgeEvent>): BridgeEvent =>
  ({ seq: 1, at: '2026-09-13T10:00:00Z', kind: 'attention', title: 'Ada needs your input', body: 'Which font?', ...over })

describe('Studio events', () => {
  it('sends a coordinator post with its author, including one addressed to the person', async () => {
    const { outbound, sent } = bench()
    await outbound.onStudioEvent(event({ body: ' Two tasks are done. ' }))
    await outbound.onStudioEvent(event({ body: 'For you', target: 'user' }))
    expect(sent).toEqual(['Bo: Two tasks are done.', 'Bo: For you'])
  })

  it('ends typing as a coordinator post goes out, and when the coordinator\'s turn ends either way', async () => {
    const { outbound, typing } = bench()
    await outbound.onStudioEvent(event({ body: 'On it.' }))
    expect(typing.stop).toHaveBeenCalledTimes(1)
    await outbound.onStudioEvent(event({ author: 'user', body: 'mine' }))
    expect(typing.stop).toHaveBeenCalledTimes(1)
    await outbound.onBridgeEvent(bridge({ kind: 'agent-finished', sessionId: 's-bo' }))
    await outbound.onBridgeEvent(bridge({ kind: 'agent-error', sessionId: 's-bo', body: 'boom' }))
    await outbound.onBridgeEvent(bridge({ kind: 'agent-finished', sessionId: 's-other' }))
    expect(typing.stop).toHaveBeenCalledTimes(3)
    const off = bench({ forwardAttention: false })
    await off.outbound.onBridgeEvent(bridge({ kind: 'agent-finished', sessionId: 's-bo' }))
    expect(off.typing.stop).toHaveBeenCalledTimes(1)
  })

  it('never sends the person their own post, a post to another agent, an empty post or a non-message', async () => {
    const { outbound, sent } = bench()
    await outbound.onStudioEvent(event({ author: 'user', body: 'hello' }))
    await outbound.onStudioEvent(event({ target: 's-ada', body: 'Do the hero' }))
    await outbound.onStudioEvent(event({ body: '' }))
    await outbound.onStudioEvent(event({ kind: 'assignment', body: 'Plan' }))
    expect(sent).toEqual([])
  })

  it('names an author comm does not know by id, and one with comm absent', async () => {
    const { outbound, sent } = bench({}, { comm: false })
    await outbound.onStudioEvent(event({ body: 'hi' }))
    expect(sent).toEqual(['s-bo: hi'])
  })

  it('sends one line when a task on a project timeline ends', async () => {
    const { outbound, sent } = bench()
    await outbound.onStudioEvent(event({ project: '/work/site', kind: 'task-update', subtype: 'done', taskId: 't1', body: 'Shipped' }))
    expect(sent).toEqual(['Finished: Hero copy (site)\nShipped'])
  })

  it('sends the ending without a goal when the Studio is absent', async () => {
    const { outbound, sent } = bench({}, { studio: false })
    await outbound.onStudioEvent(event({ project: '/work/site', kind: 'task-update', subtype: 'failed' }))
    expect(sent).toEqual(['Could not finish (site)'])
  })

  it('ignores progress, other kinds on project timelines and anything while a toggle is off or unpaired', async () => {
    const { outbound, sent } = bench()
    await outbound.onStudioEvent(event({ project: '/work/site', kind: 'task-update', subtype: 'progress' }))
    await outbound.onStudioEvent(event({ project: '/work/site', kind: 'task-update' }))
    await outbound.onStudioEvent(event({ project: '/work/site', body: 'Finished: x' }))
    const off = bench({ forwardStudioReplies: false, forwardTaskEndings: false })
    await off.outbound.onStudioEvent(event({ body: 'hi' }))
    await off.outbound.onStudioEvent(event({ project: '/work/site', kind: 'task-update', subtype: 'done' }))
    const unpaired = bench({ chatId: '' })
    await unpaired.outbound.onStudioEvent(event({ body: 'hi' }))
    expect([...sent, ...off.sent, ...unpaired.sent]).toEqual([])
  })
})

describe('bridge events', () => {
  it('sends attention alerts and agent errors', async () => {
    const { outbound, sent } = bench()
    await outbound.onBridgeEvent(bridge({}))
    await outbound.onBridgeEvent(bridge({ kind: 'agent-error', title: 'Agent hit an error', body: 'the key expired', sessionId: 's-bo' }))
    await outbound.onBridgeEvent(bridge({ kind: 'agent-error', title: 'Agent hit an error', body: '' }))
    expect(sent).toEqual(['Ada needs your input\nWhich font?', 'Bo hit an error.\nthe key expired', 'An agent hit an error.'])
  })

  it('ignores agent-finished and other kinds, and everything while off or unpaired', async () => {
    const { outbound, sent } = bench()
    await outbound.onBridgeEvent(bridge({ kind: 'agent-finished' }))
    await outbound.onBridgeEvent(bridge({ kind: 'cron-run' }))
    const off = bench({ forwardAttention: false })
    await off.outbound.onBridgeEvent(bridge({}))
    const unpaired = bench({ chatId: '' })
    await unpaired.outbound.onBridgeEvent(bridge({}))
    expect([...sent, ...off.sent, ...unpaired.sent]).toEqual([])
  })
})
