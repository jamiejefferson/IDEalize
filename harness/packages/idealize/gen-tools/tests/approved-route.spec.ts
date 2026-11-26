/**
 * The approved-models route: the list the Models pane reads, and the one
 * change it may make, which is to have Studio ask again for a model.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { APPROVED_PATH, GEN_TOOLS_NS, installApprovedRoute } from '../src/index.ts'

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
})

/** The route over a settings section held in memory. */
async function mount(approved: Record<string, string>) {
  const ctx = new Context()
  contexts.push(ctx)
  let section: { approved: Record<string, string> } | undefined = { approved }
  const writes: unknown[] = []
  let handler: Handler | undefined
  ctx.provide('webServer', {
    register: (route: { path: string; handler: Handler }) => {
      expect(route.path).toBe(APPROVED_PATH)
      handler = route.handler
      return () => { handler = undefined }
    },
  } as never)
  ctx.provide('settings', {
    get: (ns: unknown) => ns === GEN_TOOLS_NS ? section : undefined,
    replace: (_ns: unknown, next: { approved: Record<string, string> }) => { writes.push(next); section = next; return Promise.resolve() },
  } as never)
  await ctx.plugin({ name: 'approved-route', inject: [], apply: installApprovedRoute }).await()
  const call = async (method: string, options: { body?: string; host?: string; auth?: boolean } = {}) => {
    const req = Object.assign(Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]), {
      method,
      headers: { host: options.host ?? '127.0.0.1:3080', ...options.auth === false ? {} : { 'x-idealize-auth': '1' } },
    }) as unknown as IncomingMessage
    const answer = { status: 0, body: '' }
    const res = {
      writeHead: (status: number) => { answer.status = status; return res },
      end: (body?: string) => { answer.body = body ?? '' },
    } as unknown as ServerResponse
    await handler!(req, res)
    return { status: answer.status, json: () => JSON.parse(answer.body) as { models?: unknown; error?: string; ok?: boolean } }
  }
  return { call, writes, forget: () => { section = undefined } }
}

describe(`GET ${APPROVED_PATH}`, () => {
  it('lists the approved models by name, and nothing when the section holds none', async () => {
    const { call, forget } = await mount({ 'fal/fal-ai/veo3': 'Veo 3', 'openrouter/google/imagen': 'Imagen' })
    const listed = await call('GET')
    expect(listed.status).toBe(200)
    expect(listed.json().models).toEqual([
      { key: 'openrouter/google/imagen', backend: 'openrouter', model: 'google/imagen', name: 'Imagen' },
      { key: 'fal/fal-ai/veo3', backend: 'fal', model: 'fal-ai/veo3', name: 'Veo 3' },
    ])
    forget()
    expect((await call('GET')).json().models).toEqual([])
  })

  it('answers loopback callers only', async () => {
    const { call } = await mount({})
    expect((await call('GET', { host: 'evil.example' })).status).toBe(403)
    expect((await call('GET', { host: 'localhost:1' })).status).toBe(200)
    expect((await call('GET', { host: '[::1]:1' })).status).toBe(200)
    const req = { method: 'GET', headers: {} } as unknown as IncomingMessage
    expect(req.headers.host).toBeUndefined()
  })
})

describe(`POST ${APPROVED_PATH}`, () => {
  it('takes a model off the list so Studio asks again', async () => {
    const { call, writes } = await mount({ 'fal/fal-ai/veo3': 'Veo 3', 'openrouter/google/imagen': 'Imagen' })
    const answer = await call('POST', { body: JSON.stringify({ key: 'fal/fal-ai/veo3', approved: false }) })
    expect(answer.status).toBe(200)
    expect(answer.json()).toEqual({ ok: true, models: [{ key: 'openrouter/google/imagen', backend: 'openrouter', model: 'google/imagen', name: 'Imagen' }] })
    expect(writes).toEqual([{ approved: { 'openrouter/google/imagen': 'Imagen' } }])
  })

  it('never approves a model: a yes belongs to the question that shows the price', async () => {
    const { call, writes } = await mount({})
    for (const body of [{ key: 'fal/x', approved: true }, { key: '', approved: false }, { approved: false }, { key: 7, approved: false }]) {
      expect((await call('POST', { body: JSON.stringify(body) })).status).toBe(400)
    }
    expect((await call('POST', { body: '{' })).status).toBe(400)
    expect(writes).toEqual([])
  })

  it('demands the auth header and refuses other methods', async () => {
    const { call } = await mount({})
    expect((await call('POST', { body: '{}', auth: false })).status).toBe(403)
    expect((await call('DELETE')).status).toBe(405)
  })
})
