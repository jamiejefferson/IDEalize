/**
 * A key gateway: one key from an organisation's gateway reaches every model
 * service the organisation pays for. The gateway holds the real provider keys,
 * enforces what each person's key allows, and records spend. The person pastes
 * the gateway's address and their key under Brains, and IDEalize reads
 * `GET <address>/v1/me` to learn which services the key reaches and where each
 * one answers. No gateway is named in this code: the address is the person's
 * own setting, so the public app knows none.
 *
 * Each service the gateway lists becomes its own route beside any direct key
 * the person holds: `gateway-anthropic` and `gateway-openrouter` for chat
 * (serving the installed catalog through llm-pi-ai's `catalog`), and
 * `gateway-fal` and `gateway-openrouter` for pictures, sound and video. The
 * router counts a gateway route as the company it fronts, so a failing
 * gateway hands a turn to the direct key without a question, and back.
 *
 * The last good answer is kept on disk (without the key), so the app starts
 * with its gateway routes in place and keeps them through a gateway outage;
 * the answer is re-read in the background on start and every 30 minutes.
 * @module @idealize/services/gateway
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MEDIA_SERVICES } from './media-directory.ts'
import type { MediaServiceRow } from './media-directory.ts'
import { registerMediaRow } from './registrar.ts'
import type { RegistrarOptions } from './registrar.ts'

/** The credential holding the person's gateway key. */
export const GATEWAY_KEY_ENV = 'GATEWAY_API_KEY'
/** The credential holding the gateway's address, so one keys file can carry both. */
export const GATEWAY_URL_ENV = 'GATEWAY_URL'
/** Every route and backend the gateway adds starts with this, and nothing else does. */
export const GATEWAY_PREFIX = 'gateway-'
/** The last good `/v1/me` answer, without the key. */
export const GATEWAY_STATE_FILE = 'gateway-me.json'
/** How long a check of the gateway may take before the app stops waiting. */
export const GATEWAY_TIMEOUT_MS = 5_000
/** How often the gateway's list of services is read again. */
export const GATEWAY_REFRESH_MS = 30 * 60_000

const LLM_NS = settingsNamespace('llm-pi-ai')

/** One service the gateway lists. */
export interface GatewayService {
  id: string
  label?: string
  base_url?: string
}

/** The gateway's answer about one key. */
export interface GatewayMe {
  key?: { id?: string; name?: string; kind?: string; last4?: string }
  preset?: string
  budget_gbp?: number | null
  spent_this_month_gbp?: number
  services?: GatewayService[]
}

/** What the Brains pane shows about the gateway; never the key. */
export interface GatewayStatus {
  configured: boolean
  address?: string
  connected: boolean
  keyName?: string
  last4?: string
  preset?: string
  budgetGbp?: number | null
  spentGbp?: number
  /** The services the key reaches, by the gateway's own labels. */
  services: string[]
  /** The services IDEalize uses, by id. */
  used: string[]
  checkedAt?: string
  /** The gateway's own words when it refused, or why it could not be asked. */
  error?: string
}

/**
 * A gateway address as the app keeps it: https, or a local address for a test
 * gateway on this computer, with no trailing slash.
 * @param raw - what the person typed.
 * @returns the address, or the reason it cannot be used.
 */
export function gatewayAddress(raw: string): { address: string } | { error: string } {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { error: 'That is not a web address.' }
  }
  const local = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/u.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { error: 'The gateway address must start with https.' }
  }
  if (url.search !== '' || url.hash !== '') return { error: 'The gateway address takes no query or fragment.' }
  return { address: `${url.origin}${url.pathname}`.replace(/\/+$/u, '') }
}

/** What reading the gateway came back with. */
export type MeReading = { ok: true; me: GatewayMe } | { ok: false; status: number; error: string }

/**
 * Ask the gateway about a key. Never throws.
 * @param address - the gateway address.
 * @param key - the person's gateway key.
 * @param fetchImpl - the transport.
 * @returns the answer, or the status and the words to show.
 */
export async function readMe(address: string, key: string, fetchImpl: typeof fetch = fetch): Promise<MeReading> {
  let response: Response
  try {
    response = await fetchImpl(`${address}/v1/me`, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, status: 0, error: 'The gateway did not answer.' }
  }
  const body = await response.json().catch(() => null) as (GatewayMe & { error?: { message?: unknown } | string; detail?: unknown }) | null
  if (!response.ok) {
    const said = typeof body?.error === 'string' ? body.error
      : typeof body?.error?.message === 'string' ? body.error.message
        : typeof body?.detail === 'string' ? body.detail : undefined
    const fallback = response.status === 401 ? 'The gateway does not recognise this key.' : `The gateway answered ${String(response.status)}.`
    return { ok: false, status: response.status, error: said ?? fallback }
  }
  if (body === null || typeof body !== 'object') return { ok: false, status: response.status, error: 'The gateway gave an answer this app cannot read.' }
  return { ok: true, me: body }
}

const serviceOf = (me: GatewayMe, id: string): GatewayService | undefined =>
  (Array.isArray(me.services) ? me.services : []).find(service => service.id === id)

const trimSlash = (value: string): string => value.replace(/\/+$/u, '')
const withoutV1 = (value: string): string => trimSlash(value).replace(/\/v1$/u, '')

/** Where a service answers: the gateway's own `base_url`, else `<address>/<id>`. */
const baseOf = (address: string, service: GatewayService): string =>
  trimSlash(typeof service.base_url === 'string' && service.base_url !== '' ? service.base_url : `${address}/${service.id}`)

/** The chat routes one answer adds, as llm-pi-ai profiles keyed by route. */
export function chatRoutesFor(address: string, me: GatewayMe): Record<string, Record<string, unknown>> {
  const routes: Record<string, Record<string, unknown>> = {}
  const anthropic = serviceOf(me, 'anthropic')
  if (anthropic !== undefined) {
    // The Anthropic SDK adds /v1/messages itself.
    routes[`${GATEWAY_PREFIX}anthropic`] = {
      displayName: 'Anthropic via gateway', catalog: 'anthropic', baseURL: withoutV1(baseOf(address, anthropic)), apiKeyEnv: GATEWAY_KEY_ENV,
    }
  }
  const openrouter = serviceOf(me, 'openrouter')
  if (openrouter !== undefined) {
    routes[`${GATEWAY_PREFIX}openrouter`] = {
      displayName: 'OpenRouter via gateway', catalog: 'openrouter', baseURL: `${withoutV1(baseOf(address, openrouter))}/v1`, apiKeyEnv: GATEWAY_KEY_ENV,
    }
  }
  return routes
}

/** The picture, sound and video services one answer adds. */
export function mediaRowsFor(address: string, me: GatewayMe): MediaServiceRow[] {
  const rows: MediaServiceRow[] = []
  const fal = serviceOf(me, 'fal')
  const direct = MEDIA_SERVICES.find(row => row.id === 'fal')
  if (fal !== undefined && direct !== undefined) {
    // The catalogue is public and read without a key; prices need one, and the
    // gateway key must not reach the provider directly, so they are left out.
    const { pricingUrl: _prices, ...rest } = direct
    rows.push({ ...rest, id: `${GATEWAY_PREFIX}fal`, name: 'fal.ai via gateway', queueUrl: `${baseOf(address, fal)}/queue`, apiKeyEnv: GATEWAY_KEY_ENV })
  }
  const openrouter = serviceOf(me, 'openrouter')
  const directImages = MEDIA_SERVICES.find(row => row.id === 'openrouter')
  if (openrouter !== undefined) {
    rows.push({
      // The model list is public; a gateway answers only keyed requests, and this read carries none.
      ...directImages === undefined ? {} : { catalogUrl: directImages.baseUrl },
      id: `${GATEWAY_PREFIX}openrouter`, name: 'OpenRouter via gateway', adapter: 'images',
      baseUrl: `${withoutV1(baseOf(address, openrouter))}/v1`, apiKeyEnv: GATEWAY_KEY_ENV,
    })
  }
  return rows
}

/**
 * Where Jev's Decisions endpoint answers through the gateway, when it fronts OpenRouter.
 * @param address - the gateway address.
 * @param me - the gateway's answer.
 * @returns the address, or undefined when the gateway does not front OpenRouter.
 */
export function gatewayDecisionsUrl(address: string, me: GatewayMe): string | undefined {
  const openrouter = serviceOf(me, 'openrouter')
  // OpenRouter answers chat at /api/v1 and decisions at /api/alpha; the gateway's /v1 stands for /api/v1.
  return openrouter === undefined ? undefined : `${withoutV1(baseOf(address, openrouter))}/alpha/decisions`
}

/**
 * The status the pane shows.
 * @param address - the gateway address, when set.
 * @param me - the last good answer.
 * @param extra - when it was read and any error since.
 * @returns the status, with no key in it.
 */
export function statusOf(
  address: string | undefined,
  me: GatewayMe | undefined,
  extra: { checkedAt?: string; error?: string; connected: boolean },
): GatewayStatus {
  const services = Array.isArray(me?.services) ? me.services : []
  return {
    configured: address !== undefined,
    ...address === undefined ? {} : { address },
    connected: extra.connected,
    ...typeof me?.key?.name === 'string' ? { keyName: me.key.name } : {},
    ...typeof me?.key?.last4 === 'string' ? { last4: me.key.last4 } : {},
    ...typeof me?.preset === 'string' ? { preset: me.preset } : {},
    ...me === undefined || me.budget_gbp === undefined ? {} : { budgetGbp: me.budget_gbp },
    ...typeof me?.spent_this_month_gbp === 'number' ? { spentGbp: me.spent_this_month_gbp } : {},
    services: services.map(service => service.label ?? service.id),
    used: services.map(service => service.id).filter(id => ['anthropic', 'openrouter', 'fal'].includes(id)),
    ...extra.checkedAt === undefined ? {} : { checkedAt: extra.checkedAt },
    ...extra.error === undefined ? {} : { error: extra.error },
  }
}

/** What the gateway needs from the services plugin. */
export interface GatewayOptions {
  home: string
  registrar: RegistrarOptions
  fetchImpl?: typeof fetch
}

/** The gateway's face for other plugins: the router asks it where Jev answers. */
export interface GatewayFace {
  /** Check, store and switch on a gateway; the refusal, or undefined once connected. */
  connect(address: string, key: string): Promise<{ status: number; error: string } | undefined>
  /** Jev's address and the key to send, when the gateway fronts OpenRouter. */
  decisions(): Promise<{ url: string; key: string } | undefined>
  status(): GatewayStatus
}

/**
 * Run the gateway: restore its routes, keep its list fresh, and serve
 * `/idealize/brains/gateway` (GET status, POST connect, DELETE disconnect).
 * @param ctx - the services plugin context.
 * @param options - home, registrar timings and a test fetch.
 * @returns the face other plugins read.
 */
export function installGateway(ctx: Context, options: GatewayOptions): GatewayFace {
  const fetchImpl = options.fetchImpl ?? fetch
  const stateFile = join(options.home, GATEWAY_STATE_FILE)
  let address: string | undefined
  let me: GatewayMe | undefined
  let checkedAt: string | undefined
  let error: string | undefined
  let connected = false
  let applied = { chat: '', media: '' }
  const mediaHandles = new Map<string, () => void>()

  const resolve = async (env: string): Promise<string | undefined> => {
    const value = (await ctx.credentials.resolve(credentialRef(env)).catch(() => undefined))?.value
    return value === undefined || value.trim() === '' ? undefined : value.trim()
  }

  /** Make the app's routes match one answer, or remove them all with none. */
  const apply = async (answer: GatewayMe | undefined): Promise<void> => {
    const chat = address === undefined || answer === undefined ? {} : chatRoutesFor(address, answer)
    const chatKey = JSON.stringify(chat)
    if (chatKey !== applied.chat) {
      const current = ctx.settings.get(LLM_NS) as { providers?: Record<string, unknown> } | undefined
      const stale = Object.keys(current?.providers ?? {}).filter(route => route.startsWith(GATEWAY_PREFIX) && !(route in chat))
      if (stale.length > 0) await ctx.settings.mutate(LLM_NS, stale.map(route => ({ op: 'unset' as const, path: ['providers', route] })))
      if (Object.keys(chat).length > 0) await ctx.settings.update(LLM_NS, { providers: chat })
      applied = { ...applied, chat: chatKey }
      // A default model whose route has nothing behind it moves to one that answers, the gateway included.
      await (ctx.get('idealizeDefaultModel') as { reconsider?: () => Promise<void> } | undefined)?.reconsider?.()
    }
    const rows = address === undefined || answer === undefined ? [] : mediaRowsFor(address, answer)
    const mediaKey = JSON.stringify(rows)
    if (mediaKey !== applied.media) {
      for (const dispose of mediaHandles.values()) dispose()
      mediaHandles.clear()
      for (const row of rows) mediaHandles.set(row.id, registerMediaRow(ctx, row, options.registrar))
      applied = { ...applied, media: mediaKey }
    }
  }

  const save = async (answer: GatewayMe): Promise<void> => {
    await writeFile(stateFile, JSON.stringify({ address, me: answer, checkedAt }, null, 2), 'utf8').catch(() => undefined)
  }

  /** Read the gateway again and follow its answer. A gateway that does not answer keeps the last good routes. */
  const refresh = async (): Promise<MeReading | undefined> => {
    address = await resolve(GATEWAY_URL_ENV)
    const key = await resolve(GATEWAY_KEY_ENV)
    if (address === undefined || key === undefined) {
      me = undefined
      connected = false
      await apply(undefined)
      return undefined
    }
    const reading = await readMe(address, key, fetchImpl)
    checkedAt = new Date().toISOString()
    if (reading.ok) {
      me = reading.me
      connected = true
      error = undefined
      await save(reading.me)
      await apply(reading.me)
    } else {
      error = reading.error
      // A refused key reaches nothing, so its routes go; a gateway that could not be asked keeps them.
      if (reading.status === 401 || reading.status === 403) {
        connected = false
        await apply(undefined)
      }
    }
    return reading
  }

  const restore = async (): Promise<void> => {
    address = await resolve(GATEWAY_URL_ENV)
    if (address === undefined || await resolve(GATEWAY_KEY_ENV) === undefined) return
    const saved = await readFile(stateFile, 'utf8').then(text => JSON.parse(text) as { address?: string; me?: GatewayMe; checkedAt?: string }, () => undefined)
    if (saved?.address !== address || saved.me === undefined) return
    me = saved.me
    connected = true
    checkedAt = saved.checkedAt
    await apply(saved.me)
  }

  const warn = (what: string) => (cause: unknown): void => {
    ctx.logger.warn(`idealize-services: the key gateway ${what}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  ctx.effect(() => {
    void restore().then(refresh).catch(warn('could not start'))
    const timer = setInterval(() => { void refresh().catch(warn('could not be read')) }, GATEWAY_REFRESH_MS)
    return () => {
      clearInterval(timer)
      for (const dispose of mediaHandles.values()) dispose()
      mediaHandles.clear()
    }
  }, 'idealize-services: key gateway')

  const status = (): GatewayStatus => statusOf(address, me, {
    connected,
    ...checkedAt === undefined ? {} : { checkedAt },
    ...error === undefined ? {} : { error },
  })

  /**
   * Check an address and a key with the gateway, then store both and add its routes. Nothing is stored when the
   * gateway refuses or cannot be asked.
   */
  const connect = async (rawAddress: string, rawKey: string): Promise<{ status: number; error: string } | undefined> => {
    const parsed = gatewayAddress(rawAddress)
    if ('error' in parsed) return { status: 400, error: parsed.error }
    const key = rawKey.trim()
    if (key === '' || /[\s\p{Cc}]/u.test(key)) return { status: 400, error: 'Paste the key the gateway gave you.' }
    const reading = await readMe(parsed.address, key, fetchImpl)
    if (!reading.ok) return { status: reading.status === 0 ? 502 : reading.status, error: reading.error }
    try {
      await ctx.credentials.set(credentialRef(GATEWAY_URL_ENV), parsed.address)
      await ctx.credentials.set(credentialRef(GATEWAY_KEY_ENV), key)
    } catch (cause) {
      return { status: 409, error: cause instanceof Error ? cause.message : String(cause) }
    }
    await refresh()
    return undefined
  }

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/brains/gateway',
      handler: async (req, res) => {
        if (refuse(req, res, req.method !== 'GET')) return
        if (req.method === 'GET') {
          send(res, 200, status())
          return
        }
        if (req.method === 'DELETE') {
          await ctx.credentials.unset(credentialRef(GATEWAY_KEY_ENV)).catch(() => undefined)
          await ctx.credentials.unset(credentialRef(GATEWAY_URL_ENV)).catch(() => undefined)
          await rm(stateFile, { force: true }).catch(() => undefined)
          error = undefined
          checkedAt = undefined
          await refresh()
          send(res, 200, status())
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST, DELETE' }).end('method not allowed')
          return
        }
        let body: { address?: unknown; key?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          send(res, 400, { error: 'invalid JSON' })
          return
        }
        const refusal = await connect(typeof body.address === 'string' ? body.address : '', typeof body.key === 'string' ? body.key : '')
        if (refusal !== undefined) {
          send(res, refusal.status, { error: refusal.error })
          return
        }
        send(res, 200, status())
      },
    }), 'idealize-services: key gateway route')
  })

  return {
    connect,
    async decisions() {
      const key = await resolve(GATEWAY_KEY_ENV)
      const url = address === undefined || me === undefined || !connected ? undefined : gatewayDecisionsUrl(address, me)
      return url === undefined || key === undefined ? undefined : { url, key }
    },
    status,
  }
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/u, '')
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}
