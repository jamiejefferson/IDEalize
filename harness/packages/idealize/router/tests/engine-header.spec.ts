import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { apply, ROUTING_HEADER } from '../src/index.ts'

type Contributor = (sessionId: string) => Record<string, string> | undefined

/** Mount the router beside a stand-in attribution service and three chats, two of which record a preset. */
async function mount(config: object): Promise<Contributor> {
  const ctx = new Context()
  const contributors: Contributor[] = []
  const chats: Record<string, { events: unknown[] }> = {
    'chat-admin': { events: [{ type: 'idealize/brain', data: { brain: 'admin', instructions: '' } }] },
    'chat-coding': { events: [{ type: 'idealize/brain', data: { brain: 'coding', instructions: '' } }] },
    'chat-plain': { events: [] },
  }
  ctx.provide('llm', { listConfigurableProviders: () => [], listModels: () => Promise.resolve([]) })
  ctx.provide('settings', { get: () => undefined, update: () => Promise.resolve(), register: () => () => {} })
  ctx.provide('credentials', { resolve: () => Promise.resolve(undefined) })
  ctx.provide('sessions', { get: (id: string) => chats[id] })
  ctx.provide('idealizeAttribution', {
    contribute: (contributor: Contributor) => {
      contributors.push(contributor)
      return () => {}
    },
  })
  await ctx.plugin({ name: 'idealize-router', inject: [], apply }, config)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(contributors).toHaveLength(1)
  return contributors[0]!
}

describe('the free-token engine follows the Cheaper to Smarter slider', () => {
  it('every chat’s requests carry the same vector, whatever preset the chat records', async () => {
    const headers = await mount({})
    // The slider rests at 35 and the app-wide speed weight at 33: speed takes 33 parts of 68, intelligence 35.
    expect(headers('chat-plain')).toEqual({ [ROUTING_HEADER]: '0.500,0.243,0.257' })
    expect(headers('chat-admin')).toEqual(headers('chat-plain'))
    expect(headers('chat-coding')).toEqual(headers('chat-plain'))
    expect(headers('no-such-chat')).toBeUndefined()
  })

  it('criteria stored for a preset by an earlier version change nothing', async () => {
    const headers = await mount({ brains: { coding: { speed: 10, intelligence: 90 } }, offBrains: ['coding'] })
    expect(headers('chat-coding')).toEqual({ [ROUTING_HEADER]: '0.500,0.243,0.257' })
  })

  it('moving the slider towards Smarter reaches the engine', async () => {
    const headers = await mount({ lean: 99 })
    expect(headers('chat-plain')).toEqual({ [ROUTING_HEADER]: '0.500,0.125,0.375' })
  })
})
