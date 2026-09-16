/**
 * The Services route on a real composition booted through the vendored
 * Loader: storage, the settings file, the local credential store, the web
 * server, the LLM runtime with the pi-ai adapter declaring a chat route, the
 * generation seam, the services plugin's own fal backend pointed at a fake fal
 * on loopback, and
 * `@idealize/services` over both.
 *
 * - GET serves one list carrying the chat route and the generation backend,
 *   each saying what it makes, with the connected ones first.
 * - Connecting the media service with a key stores that key under the name the
 *   backend declares and connects it, with no endpoint supplied by the caller.
 * - Connecting the chat route stores its key AND records `apiKeyEnv` in the
 *   pi-ai settings section, which is what activates a dormant route: the key
 *   alone would connect nothing.
 * - An empty key removes a stored one.
 * - The mutation is fenced: no `x-idealize-auth` header is refused, and an
 *   unknown service is refused rather than written anywhere.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import GenerationRuntime from '@idealize/generate'
import * as Services from '../src/index.ts'

interface ServiceRow {
  id: string
  kind: 'chat' | 'media'
  name: string
  makes: string[]
  connected: boolean
  keyUrl?: string
}

let roots: string[] = []
let contexts: Context[] = []
let servers: Server[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const server of servers.splice(0)) await new Promise<void>(resolve => server.close(() => { resolve() }))
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  roots = []
  contexts = []
  servers = []
})

/** A fake fal on loopback: one catalogue page per category the backend lists. */
async function fakeFal(): Promise<string> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/models') {
      const category = url.searchParams.get('category')
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        models: category === 'text-to-video'
          ? [{ endpoint_id: 'acme/cut', metadata: { display_name: 'Acme Cut', category, status: 'active', kind: 'inference' } }]
          : [],
        has_more: false,
      }))
      return
    }
    res.writeHead(404).end('not found')
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => { resolve() }))
  const port = (server.address() as { port: number }).port
  return `http://127.0.0.1:${String(port)}`
}

async function boot(root: string, fal: string): Promise<{ ctx: Context; port: number }> {
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
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
    "- name: '@deepseek-ai/dsh-llm'",
    "- name: '@deepseek-ai/dsh-llm-pi-ai'",
    "- name: '@idealize/generate'",
    "- name: '@idealize/services'",
    '  config:',
    '    catalogueRefreshMinutes: 0',
    '    mediaEndpoints:',
    '      fal:',
    `        baseUrl: ${JSON.stringify(`${fal}/v1`)}`,
    `        queueUrl: ${JSON.stringify(fal)}`,
    '',
  ].join('\n'))

  const context = new Context()
  contexts.push(context)
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-llm-pi-ai', LlmPiAi],
    ['@idealize/generate', GenerationRuntime],
    ['@idealize/services', Services],
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

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'idealize-services-'))
  roots.push(root)
  return root
}

async function list(port: number): Promise<ServiceRow[]> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/brains/services`)
  return ((await response.json()) as { services: ServiceRow[] }).services
}

async function connect(
  port: number,
  body: unknown,
  auth = true,
): Promise<{ status: number; services?: ServiceRow[]; error?: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/idealize/brains/services`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth ? { 'x-idealize-auth': '1' } : {} },
    body: JSON.stringify(body),
  })
  const parsed = response.status === 200 || response.headers.get('content-type')?.includes('json') === true
    ? (await response.json()) as { services?: ServiceRow[]; error?: string }
    : {}
  return { status: response.status, ...parsed }
}

describe('the services route on a real composition', () => {
  it('serves one list carrying both kinds, each saying what it makes', async () => {
    const fal = await fakeFal()
    const { port } = await boot(await makeRoot(), fal)
    const services = await list(port)
    const media = services.find(row => row.kind === 'media')
    expect(media).toMatchObject({ id: 'fal', name: 'fal.ai', connected: false })
    // fal's shipped endpoints cover all three artefacts before any key is stored.
    expect(media?.makes).toEqual(['image', 'video', 'audio'])
    expect(media?.keyUrl).toBe('https://fal.ai/dashboard/keys')
    // The pi-ai adapter's catalogue routes are the chat half of the same list.
    expect(services.some(row => row.kind === 'chat')).toBe(true)
    expect(services.every(row => row.makes.length > 0)).toBe(true)
  })

  it('connects a media service from a key alone, with no endpoint from the caller', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    const stored = await connect(port, { id: 'fal', kind: 'media', apiKey: 'fal-secret' })
    expect(stored.status).toBe(200)
    expect(stored.services?.find(row => row.kind === 'media')?.connected).toBe(true)
    // The key landed under the name the backend itself declares.
    expect((await ctx.credentials.resolve(credentialRef('FAL_KEY')))?.value).toBe('fal-secret')
  })

  it('records the credential name on a chat route, which is what activates it', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    // A dormant route: the machine running the tests may hold real keys in its
    // environment, and those routes read as already connected.
    const chat = (await list(port)).find(row => row.kind === 'chat' && !row.connected)!
    const stored = await connect(port, { id: chat.id, kind: 'chat', apiKey: 'chat-secret' })
    expect(stored.status).toBe(200)
    const section = ctx.settings.get(settingsNamespace('llm-pi-ai')) as
      { providers?: Record<string, { apiKeyEnv?: string }> } | undefined
    const env = section?.providers?.[chat.id]?.apiKeyEnv
    expect(env).toBe(`${chat.id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`)
    expect((await ctx.credentials.resolve(credentialRef(env!)))?.value).toBe('chat-secret')
    expect(stored.services?.find(row => row.id === chat.id)?.connected).toBe(true)
  })

  it('removes a stored key when the field is submitted empty', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    await connect(port, { id: 'fal', kind: 'media', apiKey: 'fal-secret' })
    const cleared = await connect(port, { id: 'fal', kind: 'media', apiKey: '' })
    expect(cleared.status).toBe(200)
    expect(await ctx.credentials.resolve(credentialRef('FAL_KEY'))).toBeUndefined()
    expect(cleared.services?.find(row => row.kind === 'media')?.connected).toBe(false)
  })

  it('refuses a mutation without the auth header, and an unknown service', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    expect((await connect(port, { id: 'fal', kind: 'media', apiKey: 'k' }, false)).status).toBe(403)
    expect((await connect(port, { id: 'nope', kind: 'media', apiKey: 'k' })).status).toBe(400)
    expect((await connect(port, { id: 'fal', kind: 'chat', apiKey: 'k' })).status).toBe(400)
    // Nothing was written by any of the refusals.
    expect(await ctx.credentials.resolve(credentialRef('FAL_KEY'))).toBeUndefined()
  })

  it('refuses a key carrying characters an API key cannot hold', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    const refused = await connect(port, { id: 'fal', kind: 'media', apiKey: 'has space' })
    expect(refused.status).toBe(400)
    expect(await ctx.credentials.resolve(credentialRef('FAL_KEY'))).toBeUndefined()
  })

  it('names the environment as the reason when a key cannot be overwritten', async () => {
    const fal = await fakeFal()
    process.env['FAL_KEY'] = 'from-the-shell'
    try {
      const { port } = await boot(await makeRoot(), fal)
      const refused = await connect(port, { id: 'fal', kind: 'media', apiKey: 'pasted' })
      // Not "check the key": the person's key is fine, their shell is the author.
      expect(refused.status).toBe(409)
      expect(refused.error).toContain('launching environment')
    } finally {
      delete process.env['FAL_KEY']
    }
  })

  it('drops its route with its fiber', async () => {
    const fal = await fakeFal()
    const { ctx, port } = await boot(await makeRoot(), fal)
    expect((await list(port)).length).toBeGreaterThan(0)
    await ctx.fiber.dispose()
    contexts.length = 0
    await expect(fetch(`http://127.0.0.1:${String(port)}/idealize/brains/services`)).rejects.toThrow()
  })
})
