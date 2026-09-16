/**
 * The `/idealize/brains/services` routes. GET serves one list of every service
 * the app can connect — chat routes and generation backends together, each
 * saying what it makes and whether it is connected. POST stores (or, with an
 * empty key, removes) one service's API key, choosing where the key belongs
 * from the service's kind so the caller never has to know. POST `/import`
 * takes a keys file — several keys at once, each named by the credential it
 * fills — and connects every service those credentials belong to in one call.
 *
 * The caller supplies a name and a key. It supplies no endpoint, no wire
 * protocol and no route id, because a person adding a service they hold an
 * account with knows none of those and should not be asked.
 *
 * Loopback-fenced; the mutations demand the `x-idealize-auth` header, matching
 * `/idealize/brains/media-keys`.
 * @module @idealize/services/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { joinServices } from './join.ts'
import type { ChatCandidate, MediaCandidate } from './join.ts'
import type { ServiceRow } from './directory.ts'

/**
 * Twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm` (mirrored by
 * `LEGAL_API_KEY` in `@idealize/generate` and `@idealize/onboarding`):
 * printable ASCII, space excluded.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** The one keys-file format this build reads. */
export const KEYS_FILE_FORMAT = 1

/** The most credentials one keys file may carry; a file past it is not a keys file. */
const KEYS_FILE_MAX_ENTRIES = 64

/** Twin of `REF_PATTERN` in `@deepseek-ai/dsh-credentials`: a credential name is a POSIX environment name. */
const CREDENTIAL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The credential reference a chat route's key is stored under. Twin of
 * `deriveKeyRef` in `dsh-client-ui-settings-models`: the same route keyed from
 * either surface must reach the same credential, or a key pasted here would be
 * invisible to the models page and the route would stay unauthenticated.
 * @param provider - the chat route id.
 * @returns the credential environment name.
 */
export function chatKeyEnv(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** The queries this route reads its list from, and the writes it performs. */
export interface ServicesRuntime {
  /** Every chat route the LLM directory declares, with whether its key resolves. */
  chat(): Promise<ChatCandidate[]>
  /** Every registered generation backend that takes a key, with its artefacts. */
  media(): MediaCandidate[]
  /** Store a chat route's `apiKeyEnv` so the route activates; a no-op when already recorded. */
  recordChatKeyEnv(provider: string, env: string): Promise<void>
  /** Drop a chat route's `apiKeyEnv` when it names `env`, so a removed key leaves no record reading the route as keyed. */
  forgetChatKeyEnv(provider: string, env: string): Promise<void>
  /** Re-read a generation backend's catalogue after its key changed. */
  refreshBackend(id: string): Promise<boolean>
}

/**
 * Build the list both the GET response and the POST lookup read.
 * @param runtime - the registry queries.
 * @returns the joined rows in display order.
 */
async function listServices(runtime: ServicesRuntime): Promise<ServiceRow[]> {
  return joinServices(await runtime.chat(), runtime.media())
}

/** A refusal the route answers with its status and the reason, or nothing when the write went through. */
type Refusal = { status: number; error: string } | undefined

/**
 * Store one service's key where its kind keeps it, and wake the service. The
 * one write both the single-key POST and the keys-file import perform.
 * @param credentials - the credential store.
 * @param runtime - the registry writes.
 * @param service - the row being connected.
 * @param apiKey - the trimmed key; empty removes the stored one.
 * @returns the refusal, or undefined once the key is stored.
 */
async function storeKey(
  credentials: CredentialProvider,
  runtime: ServicesRuntime,
  service: ServiceRow,
  apiKey: string,
): Promise<Refusal> {
  const env = service.kind === 'chat' ? chatKeyEnv(service.id) : mediaEnvOf(runtime, service.id)
  if (env === undefined || env === '') {
    // credentialRef refuses an empty name, so a backend that declares
    // none is answered here rather than crashing the handler.
    return { status: 400, error: `${service.name} declares no key to store` }
  }
  const ref = credentialRef(env)
  try {
    if (apiKey === '') await credentials.unset(ref)
    else await credentials.set(ref, apiKey)
  } catch (error) {
    // The store refuses a write the launching environment would shadow.
    // That is not a bad key, and saying so would send the person back to
    // their clipboard instead of to the shell that set the variable.
    return { status: 409, error: error instanceof Error ? error.message : String(error) }
  }
  // A chat route stays dormant until its profile names the credential,
  // so the key alone would connect nothing; a removed key takes the record
  // with it, so the models page reads the route by its remaining auth.
  if (service.kind === 'chat') {
    if (apiKey !== '') await runtime.recordChatKeyEnv(service.id, env)
    else await runtime.forgetChatKeyEnv(service.id, env)
  }
  if (service.kind === 'media') {
    try {
      await runtime.refreshBackend(service.id)
    } catch {
      // The key is stored either way; a catalogue that could not be
      // re-read leaves the last-known models standing and retries on the
      // adapter's own timer.
    }
  }
  return undefined
}

/**
 * The service a credential name fills: the chat route whose derived name it is,
 * else the generation backend declaring it. A name neither owns is unknown.
 * @param runtime - the registry queries.
 * @param services - the joined rows.
 * @param env - the credential environment name from the keys file.
 * @returns the row, or undefined.
 */
function serviceOwning(runtime: ServicesRuntime, services: readonly ServiceRow[], env: string): ServiceRow | undefined {
  return services.find(row => row.signIn !== true
    && (row.kind === 'chat' ? chatKeyEnv(row.id) === env : mediaEnvOf(runtime, row.id) === env))
}

/** One keys file as its JSON reads once the format is known. */
interface KeysFile {
  format: number
  credentials: Record<string, string>
}

/**
 * Read a keys file's JSON. Everything a file can get wrong is named: the format
 * this build does not read, a credentials member that is not a flat mapping of
 * names to keys, and a key carrying characters no API key holds.
 * @param text - the request body.
 * @returns the parsed file, or the refusal.
 */
function parseKeysFile(text: string): { file: KeysFile } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'invalid JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { error: 'a keys file is a JSON object' }
  const { format, credentials } = parsed as { format?: unknown; credentials?: unknown }
  if (format === undefined) return { error: 'the keys file names no format' }
  if (format !== KEYS_FILE_FORMAT) return { error: `keys file format ${JSON.stringify(format)} is not one this app reads (expected ${String(KEYS_FILE_FORMAT)})` }
  if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
    return { error: 'credentials must be an object of credential names to keys' }
  }
  const entries = Object.entries(credentials as Record<string, unknown>)
  if (entries.length === 0) return { error: 'the keys file carries no credentials' }
  if (entries.length > KEYS_FILE_MAX_ENTRIES) return { error: `the keys file carries more than ${String(KEYS_FILE_MAX_ENTRIES)} credentials` }
  const flat: Record<string, string> = {}
  for (const [env, value] of entries) {
    if (!CREDENTIAL_NAME.test(env)) return { error: `${JSON.stringify(env)} is not a credential name` }
    if (typeof value !== 'string' || value.trim() === '') return { error: `${env} carries no key` }
    const apiKey = value.trim()
    if (!LEGAL_API_KEY.test(apiKey)) return { error: `${env} carries characters an API key cannot carry` }
    flat[env] = apiKey
  }
  return { file: { format: KEYS_FILE_FORMAT, credentials: flat } }
}

/**
 * Mount the services routes while a web server, settings and credential store
 * are composed beside the registries.
 * @param ctx - the plugin context.
 * @param runtime - the registry queries and writes the route performs.
 */
export function installServicesRoute(ctx: Context, runtime: ServicesRuntime): void {
  ctx.inject(['webServer', 'credentials'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/brains/services',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          if (refuse(req, res)) return
          sendJson(res, 200, { services: await listServices(runtime) })
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' }).end('method not allowed')
          return
        }
        if (refuse(req, res, true)) return
        let body: { id?: unknown; kind?: unknown; apiKey?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          sendJson(res, 400, { error: 'invalid JSON' })
          return
        }
        const services = await listServices(runtime)
        const service = services.find(row => row.id === body.id && row.kind === body.kind)
        if (service === undefined) {
          sendJson(res, 400, { error: 'id and kind must name a service this app can connect' })
          return
        }
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        // A sign-in route takes no key; an empty body still removes a stray one.
        if (service.signIn === true && apiKey !== '') {
          sendJson(res, 400, { error: `${service.name} is connected by signing in, not with a key` })
          return
        }
        if (apiKey !== '' && !LEGAL_API_KEY.test(apiKey)) {
          sendJson(res, 400, { error: 'apiKey contains characters an API key cannot carry' })
          return
        }
        const refusal = await storeKey(webCtx.credentials, runtime, service, apiKey)
        if (refusal !== undefined) {
          sendJson(res, refusal.status, { error: refusal.error })
          return
        }
        sendJson(res, 200, { services: await listServices(runtime) })
      },
    }), 'services: route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/brains/services/import',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('method not allowed')
          return
        }
        if (refuse(req, res, true)) return
        const parsed = parseKeysFile(await readBody(req))
        if ('error' in parsed) {
          sendJson(res, 400, { error: parsed.error })
          return
        }
        // Every name is matched before any key is stored: a file naming one
        // credential this app cannot place is refused whole, so a person is
        // never left with half a file connected and no way to tell which half.
        const services = await listServices(runtime)
        const targets: { service: ServiceRow; apiKey: string }[] = []
        for (const [env, apiKey] of Object.entries(parsed.file.credentials)) {
          const service = serviceOwning(runtime, services, env)
          if (service === undefined) {
            sendJson(res, 400, { error: `${env} is not a credential any service this app can connect takes` })
            return
          }
          targets.push({ service, apiKey })
        }
        const connected: { id: string; kind: ServiceRow['kind']; name: string }[] = []
        for (const { service, apiKey } of targets) {
          const refusal = await storeKey(webCtx.credentials, runtime, service, apiKey)
          if (refusal !== undefined) {
            sendJson(res, refusal.status, { error: `${service.name}: ${refusal.error}`, connected })
            return
          }
          connected.push({ id: service.id, kind: service.kind, name: service.name })
        }
        sendJson(res, 200, { connected, services: await listServices(runtime) })
      },
    }), 'services: import route')
  })
}

/** The credential name a generation backend declares, from the live registry. */
function mediaEnvOf(runtime: ServicesRuntime, id: string): string | undefined {
  return runtime.media().find(entry => entry.backend === id)?.env
}

/** The settings namespace whose section carries the chat provider profiles. */
export const LLM_NS = settingsNamespace('llm-pi-ai')
