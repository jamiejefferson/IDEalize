/**
 * The plugin on a real composition booted through the vendored Loader: the
 * settings file, the local credential store, the web server and
 * `@idealize/telegram`, with the Bot API pointed at a fake Telegram on
 * loopback.
 *
 * - The token route checks a token with Telegram before storing it, refuses
 *   one Telegram rejects, and removes the stored one when sent empty.
 * - Pairing: the route issues a code, the phone sends `/pair <code>` through
 *   `getUpdates`, the bot answers that chat, and the status turns paired.
 * - A Studio coordinator post reaches the paired chat.
 * - Another client polling the bot shows as a plain-words problem.
 * - Mutations are fenced, and the poller stops with the composition.
 */

import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import type { StudioEvent } from '@idealize/studio'
import { PAIR_REPLIES } from '../src/format.ts'
import * as Telegram from '../src/index.ts'
import type { TelegramStatus } from '../src/settings.ts'

const TOKEN = '123456:test-token'
const AUTH = { 'content-type': 'application/json', 'x-idealize-auth': '1' }

let roots: string[] = []
let contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => { resolve() }))
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  roots = []
})

/** A fake Bot API: answers getMe per token, hands queued updates to getUpdates, records sends. */
async function fakeTelegram() {
  const state = {
    updates: [] as unknown[],
    sent: [] as { chat_id: string; text: string }[],
    polls: 0,
    conflict: false,
  }
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    req.on('end', () => {
      const [, bot = '', method = ''] = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '') ?? []
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
      const reply = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload))
      }
      if (bot !== TOKEN) {
        reply(401, { ok: false, error_code: 401, description: 'Unauthorized' })
        return
      }
      if (method === 'getMe') {
        reply(200, { ok: true, result: { id: 123456, username: 'idealize_test_bot' } })
        return
      }
      if (method === 'getUpdates') {
        state.polls += 1
        if (state.conflict) {
          reply(409, { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' })
          return
        }
        const offset = Number(body.offset)
        const ready = state.updates.filter(update => (update as { update_id: number }).update_id >= offset)
        state.updates = ready
        setTimeout(() => { reply(200, { ok: true, result: ready }) }, ready.length === 0 ? 30 : 0)
        return
      }
      if (method === 'sendMessage') {
        state.sent.push({ chat_id: String(body.chat_id), text: String(body.text) })
        reply(200, { ok: true, result: { message_id: state.sent.length, date: 0, chat: { id: Number(body.chat_id), type: 'private' } } })
        return
      }
      reply(200, { ok: true, result: true })
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
  return { state, origin: `http://127.0.0.1:${String((server.address() as { port: number }).port)}` }
}

async function boot(apiBase: string): Promise<{ ctx: Context; origin: string; port: number }> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-telegram-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-settings-file'",
    '  config:',
    `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@idealize/telegram'",
    '  config:',
    `    apiBase: ${JSON.stringify(apiBase)}`,
    '    holdSeconds: 1',
    '    retryDelaysMs: [20]',
    '    muxReopenDelayMs: 20',
    '',
  ].join('\n'))

  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/telegram', Telegram],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const port = ctx.webServer.port
  return { ctx, origin: `http://127.0.0.1:${String(port)}`, port }
}

async function call(origin: string, method: string, path: string, body?: unknown, headers: Record<string, string> = AUTH) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: method === 'GET' ? {} : headers,
    ...body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) },
  })
  return { status: response.status, body: await response.text() }
}

async function status(origin: string): Promise<TelegramStatus> {
  return JSON.parse((await call(origin, 'GET', Telegram.STATUS_PATH)).body) as TelegramStatus
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 300 && !(await check()); i += 1) await new Promise(resolve => setTimeout(resolve, 10))
  expect(await check()).toBe(true)
}

describe('the composed plugin', () => {
  it('stores a token Telegram accepts, pairs a chat from the phone, and sends it Studio posts', async () => {
    const telegram = await fakeTelegram()
    const { ctx, origin } = await boot(telegram.origin)

    expect(await status(origin)).toMatchObject({ configured: false, paired: false, problem: '' })
    expect((await call(origin, 'POST', Telegram.PAIR_PATH)).status).toBe(400)

    expect(await call(origin, 'POST', Telegram.TOKEN_PATH, { token: 'not a token' })).toMatchObject({ status: 400 })
    expect(await call(origin, 'POST', Telegram.TOKEN_PATH, { token: '999:wrong' })).toEqual({
      status: 400, body: JSON.stringify({ error: 'Telegram did not accept this token.' }),
    })
    const stored = await call(origin, 'POST', Telegram.TOKEN_PATH, { token: TOKEN })
    expect(stored.status).toBe(200)
    expect(JSON.parse(stored.body)).toMatchObject({ configured: true, shadowed: false, botUsername: 'idealize_test_bot' })
    expect((await ctx.credentials.resolve(credentialRef(Telegram.TOKEN_ENV)))?.value).toBe(TOKEN)

    const paired = JSON.parse((await call(origin, 'POST', Telegram.PAIR_PATH)).body) as TelegramStatus
    const code = paired.pairing?.code as string
    expect(code).toMatch(/^\d{6}$/)
    await until(() => telegram.state.polls > 0)
    telegram.state.updates.push({
      update_id: 1,
      message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: 555, type: 'private' }, text: `/pair ${code}` },
    })
    await until(() => telegram.state.sent.some(sent => sent.chat_id === '555' && sent.text === PAIR_REPLIES.paired))
    const afterPairing = await status(origin)
    expect(afterPairing.paired).toBe(true)
    expect(afterPairing.pairing).toBeUndefined()

    ctx.emit('idealize/studio-event', {
      id: 'e1', seq: 1, at: new Date().toISOString(), visibility: 'studio',
      project: 'studio', author: 's-bo', kind: 'message', body: 'Two tasks are done.',
    } as unknown as StudioEvent)
    await until(() => telegram.state.sent.some(sent => sent.chat_id === '555' && sent.text === 's-bo: Two tasks are done.'))

    expect(await status(origin)).toMatchObject({ paired: true })
    expect(JSON.parse((await call(origin, 'DELETE', Telegram.PAIR_PATH)).body)).toMatchObject({ paired: false })
    expect(JSON.parse((await call(origin, 'POST', Telegram.TOKEN_PATH, { token: '' })).body)).toMatchObject({ configured: false })
    expect(await ctx.credentials.resolve(credentialRef(Telegram.TOKEN_ENV))).toBeUndefined()
  })

  it('reports another client polling the bot, and stops polling with the composition', async () => {
    const telegram = await fakeTelegram()
    telegram.state.conflict = true
    const { ctx, origin } = await boot(telegram.origin)
    await call(origin, 'POST', Telegram.TOKEN_PATH, { token: TOKEN })
    await until(async () => (await status(origin)).problem === 'Another copy of IDEalize is using this bot, so this one is not receiving messages.')

    await ctx.fiber.dispose()
    contexts = contexts.filter(context => context !== ctx)
    const polls = telegram.state.polls
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(telegram.state.polls).toBe(polls)
  })

  it('fences the routes', async () => {
    const telegram = await fakeTelegram()
    const { origin, port } = await boot(telegram.origin)
    expect((await call(origin, 'POST', Telegram.TOKEN_PATH, { token: TOKEN }, { 'content-type': 'application/json' })).status).toBe(403)
    expect((await call(origin, 'PUT', Telegram.PAIR_PATH)).status).toBe(405)
    expect((await call(origin, 'POST', Telegram.STATUS_PATH)).status).toBe(405)
    expect(await call(origin, 'POST', Telegram.TOKEN_PATH, 'not json')).toMatchObject({ status: 400 })
    expect(await call(origin, 'POST', Telegram.TOKEN_PATH, { token: 42 })).toMatchObject({ status: 400 })
    const foreign = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: Telegram.STATUS_PATH, headers: { host: 'evil.test' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(foreign).toBe(403)
  })
})
