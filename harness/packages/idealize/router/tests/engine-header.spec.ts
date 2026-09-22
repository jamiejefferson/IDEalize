import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { apply, ROUTING_HEADER } from '../src/index.ts'

type Contributor = (sessionId: string) => Record<string, string> | undefined

/** Mount the router beside a stand-in attribution service and two chats, one per brain. */
async function mount(brains: Record<string, object>): Promise<Contributor> {
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
  await ctx.plugin({ name: 'idealize-router', inject: [], apply }, { brains })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(contributors).toHaveLength(1)
  return contributors[0]!
}

describe('the free-token engine follows the asking brain', () => {
  it('each chat’s requests carry its own brain’s priorities as the engine’s vector', async () => {
    const headers = await mount({})
    // Admin ships speed-led, Coding even between speed and intelligence, and a chat without a brain reads the app-wide values.
    expect(headers('chat-admin')).toEqual({ [ROUTING_HEADER]: '0.500,0.389,0.111' })
    expect(headers('chat-coding')).toEqual({ [ROUTING_HEADER]: '0.500,0.250,0.250' })
    expect(headers('chat-plain')).toEqual({ [ROUTING_HEADER]: '0.500,0.250,0.250' })
    expect(headers('no-such-chat')).toBeUndefined()
  })

  it('what a brain’s sheet saved reaches the engine', async () => {
    const headers = await mount({ coding: { speed: 10, intelligence: 90 } })
    expect(headers('chat-coding')).toEqual({ [ROUTING_HEADER]: '0.500,0.050,0.450' })
  })
})
