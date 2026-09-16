/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts sessions, persistence, the projection registry and
 * the web server alongside `@idealize/spaces`. Assertions observe the durable
 * record (`idealize/space` and `idealize/brain` with the ignorable envelope),
 * the projections a client reads, the route's refusals, and what unloading the
 * plugin takes away.
 */

import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as Spaces from '../src/index.ts'
import { SELECT_PATH } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Boot the spaces composition through the real Loader over a temp root. */
async function loadComposition(): Promise<{ ctx: Context; port: number }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-spaces-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'sessions'))}`,
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    '- id: idealize-spaces',
    "  name: '@idealize/spaces'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/spaces', Spaces],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, port: context.webServer.port }
}

/** POST one JSON body, with the loopback host and auth headers unless overridden. */
function post(
  port: number,
  path: string,
  payload: unknown,
  headers: Record<string, string> = { host: '127.0.0.1', 'x-idealize-auth': '1' },
  method = 'POST',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body }) })
    })
    req.on('error', reject)
    req.end(data)
  })
}

/** One raw HTTP/1.0 request, the only way to reach the route with no Host header at all. */
function raw(port: number, lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => { socket.end(`${lines.join('\r\n')}\r\n\r\n`) })
    let body = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { body += chunk })
    socket.on('end', () => { resolve(body) })
    socket.on('error', reject)
  })
}

describe('@idealize/spaces composition', () => {
  it('records the space and the brain, both marked ignorable, and projects them', async () => {
    const { ctx, port } = await loadComposition()
    const session = ctx.sessions.create()

    const response = await post(port, SELECT_PATH, {
      sessionId: String(session.header.id),
      space: 'gallery',
      brain: 'gallery',
      instructions: 'Report each artefact id.',
    })

    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, space: 'gallery', recorded: { space: true, brain: true } })

    const [space, brain] = session.events
    expect(space?.type).toBe('idealize/space')
    expect(space?.data).toEqual({ space: 'gallery' })
    expect(space?.ignorable).toBe(true)
    expect(brain?.type).toBe('idealize/brain')
    expect(brain?.data).toEqual({ brain: 'gallery', instructions: 'Report each artefact id.' })
    expect(brain?.ignorable).toBe(true)

    expect(ctx.sessionProjections.snapshot(session).values).toMatchObject({
      space: { space: 'gallery' },
      brain: { brain: 'gallery' },
    })
  })

  it('projects Chat for a chat that never recorded a space, and Gallery for a legacy media chat', async () => {
    const { ctx } = await loadComposition()
    const untouched = ctx.sessions.create()
    expect(ctx.sessionProjections.snapshot(untouched).values).toMatchObject({ space: { space: 'chat' }, brain: {} })

    const legacy = ctx.sessions.create()
    legacy.append('agent-preset/selected', { agentPreset: 'gallery' })
    expect(ctx.sessionProjections.snapshot(legacy).values).toMatchObject({ space: { space: 'gallery' } })
  })

  it('writes nothing when the recorded value already matches, so re-entering a space cannot grow the log', async () => {
    const { ctx, port } = await loadComposition()
    const session = ctx.sessions.create()
    const body = { sessionId: String(session.header.id), space: 'terminal', brain: 'coding' }

    await post(port, SELECT_PATH, body)
    const second = await post(port, SELECT_PATH, body)

    expect(JSON.parse(second.body)).toMatchObject({ recorded: { space: false, brain: false } })
    expect(session.events).toHaveLength(2)
  })

  it('refuses a body it cannot use and a session it cannot find', async () => {
    const { ctx, port } = await loadComposition()
    const sessionId = String(ctx.sessions.create().header.id)

    expect(await post(port, SELECT_PATH, 'not json')).toMatchObject({ status: 400 })
    expect(JSON.parse((await post(port, SELECT_PATH, [])).body)).toEqual({ error: 'body must be a JSON object' })
    expect(JSON.parse((await post(port, SELECT_PATH, { space: 'chat' })).body))
      .toEqual({ error: 'sessionId is required' })
    expect(JSON.parse((await post(port, SELECT_PATH, { sessionId, space: 'trajectory' })).body))
      .toEqual({ error: 'space must be one of: chat, terminal, gallery, soundstage, motion, studio' })
    expect(JSON.parse((await post(port, SELECT_PATH, { sessionId, space: 'chat', brain: '' })).body))
      .toEqual({ error: 'brain must be an agent preset id' })
    expect(JSON.parse((await post(port, SELECT_PATH, { sessionId, space: 'chat', brain: 'coding', instructions: 7 })).body))
      .toEqual({ error: 'instructions must be a string' })
    expect(JSON.parse((await post(port, SELECT_PATH, { sessionId: 'no-such-chat', space: 'chat' })).body))
      .toEqual({ error: 'no live session "no-such-chat"' })
  })

  it('answers only POST from loopback with the auth header', async () => {
    const { port } = await loadComposition()

    expect(await post(port, SELECT_PATH, {}, { host: '127.0.0.1', 'x-idealize-auth': '1' }, 'GET'))
      .toMatchObject({ status: 405 })
    expect(await post(port, SELECT_PATH, {}, { host: 'example.com' })).toMatchObject({ status: 403, body: 'loopback only' })
    expect(await post(port, SELECT_PATH, {}, { host: '127.0.0.1' }))
      .toMatchObject({ status: 403, body: 'missing x-idealize-auth header' })
    // HTTP/1.0 may omit Host entirely; a request that names no host is not loopback.
    expect(await raw(port, [`POST ${SELECT_PATH} HTTP/1.0`, 'x-idealize-auth: 1', 'content-length: 0']))
      .toContain('loopback only')
  })

  it('takes both projections and the route back when its fiber disposes', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjections)
    await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
    const fiber = ctx.plugin(Spaces)
    await fiber.await()
    const { port } = ctx.webServer
    const session = ctx.sessions.create()
    expect(Object.keys(ctx.sessionProjections.snapshot(session).values).sort()).toEqual(['brain', 'space'])
    expect(await post(port, SELECT_PATH, { sessionId: String(session.header.id), space: 'chat' }))
      .toMatchObject({ status: 200 })

    await fiber.dispose()

    expect(ctx.sessionProjections.snapshot(session).values).toEqual({})
    expect(await post(port, SELECT_PATH, { sessionId: String(session.header.id), space: 'chat' }))
      .toMatchObject({ status: 404 })
  })
})
