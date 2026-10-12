/**
 * The launch gate on a running server: with a token placed, only the app's
 * windows (cookie) and a chat's shell (session key, talk route only) get
 * through; with none placed, nothing changes (security audit, 9 Oct 2026).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HttpServer, { LAUNCH_COOKIE, LAUNCH_TOKEN_KEY, requestCaller, sessionKey } from '../src/index.ts'

const TOKEN = 'a'.repeat(64)
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  Reflect.deleteProperty(globalThis, LAUNCH_TOKEN_KEY)
})

async function boot(): Promise<HttpServer> {
  context = new Context()
  await context.plugin(HttpServer, { host: '127.0.0.1', port: 0 })
  const server = context.webServer
  server.register({
    kind: 'prefix', path: '/idealize',
    handler: (req, res) => { res.writeHead(200).end(JSON.stringify(requestCaller(req))) },
  })
  server.register({ kind: 'prefix', path: '/api', handler: (_req, res) => { res.writeHead(200).end('api') } })
  return server
}

async function call(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { headers })
  return { status: response.status, body: await response.text() }
}

describe('the launch gate', () => {
  it('stays open when no token is placed', async () => {
    const server = await boot()
    expect(await call(server.port, '/idealize/comm')).toMatchObject({ status: 200, body: '{"kind":"open"}' })
  })

  it('refuses a caller that proves nothing, the old constant header included', async () => {
    ;(globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY] = TOKEN
    const server = await boot()
    expect((await call(server.port, '/idealize/terminal/input', { 'x-idealize-auth': '1' })).status).toBe(401)
    expect((await call(server.port, '/api/rpc')).status).toBe(401)
    expect((await call(server.port, '/idealize/comm', { cookie: `${LAUNCH_COOKIE}=${'b'.repeat(64)}` })).status).toBe(401)
  })

  it('admits the app by its cookie, anywhere', async () => {
    ;(globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY] = TOKEN
    const server = await boot()
    const cookie = `other=1; ${LAUNCH_COOKIE}=${TOKEN}`
    expect(await call(server.port, '/idealize/terminal/input', { cookie })).toMatchObject({ status: 200, body: '{"kind":"app"}' })
    expect((await call(server.port, '/api/rpc', { cookie })).status).toBe(200)
  })

  it('admits a chat shell to the talk route only, as itself', async () => {
    ;(globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY] = TOKEN
    const server = await boot()
    const shell = { 'x-idealize-session': 'chat-1', 'x-idealize-key': sessionKey(TOKEN, 'chat-1') }
    expect(await call(server.port, '/idealize/comm', shell)).toMatchObject({ status: 200, body: '{"kind":"session","sessionId":"chat-1"}' })
    expect((await call(server.port, '/idealize/terminal/input', shell)).status).toBe(401)
    expect((await call(server.port, '/idealize/bar/file', shell)).status).toBe(401)
    // One chat's key does not speak for another.
    expect((await call(server.port, '/idealize/comm', { ...shell, 'x-idealize-session': 'chat-2' })).status).toBe(401)
  })

  it('refuses a foreign Host once the token is placed', async () => {
    ;(globalThis as Record<symbol, unknown>)[LAUNCH_TOKEN_KEY] = TOKEN
    const server = await boot()
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      request({ host: '127.0.0.1', port: server.port, path: '/', headers: { host: 'evil.example' } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }).on('error', reject).end()
    })
    expect(status).toBe(403)
  })
})
