/**
 * The Settings row's loopback routes. `GET /idealize/telegram/status` answers
 * what the row shows; `POST /idealize/telegram/token` checks and stores a bot
 * token (an empty token removes it); `POST /idealize/telegram/pair` issues a
 * pairing code and `DELETE /idealize/telegram/pair` unpairs. Mutations carry
 * the `x-idealize-auth: 1` header.
 * @module @idealize/telegram/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { TelegramStatus } from './settings.ts'

/** Status path. */
export const STATUS_PATH = '/idealize/telegram/status'
/** Token path. */
export const TOKEN_PATH = '/idealize/telegram/token'
/** Pairing path. */
export const PAIR_PATH = '/idealize/telegram/pair'

/** An HTTP answer the runtime chose. */
export interface RouteOutcome {
  status: number
  body: TelegramStatus | { error: string }
}

/** The operations behind the routes. */
export interface TelegramRoutesRuntime {
  status(): Promise<TelegramStatus>
  setToken(token: string): Promise<RouteOutcome>
  pair(): Promise<RouteOutcome>
  unpair(): Promise<RouteOutcome>
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Why a request may not reach its handler.
 * @param req - the request.
 * @param methods - the methods the route serves.
 * @returns the refusal to send, or undefined when the request may proceed.
 */
function refusalOf(req: IncomingMessage, methods: readonly string[]): { status: number; text: string } | undefined {
  const method = String(req.method)
  if (!methods.includes(method)) return { status: 405, text: `method not allowed; use ${methods.join(' or ')}` }
  if (!LOOPBACK_HOSTS.has(String(req.headers.host).replace(/:\d+$/, ''))) return { status: 403, text: 'loopback only' }
  if (method !== 'GET' && req.headers['x-idealize-auth'] !== '1') return { status: 403, text: 'missing x-idealize-auth header' }
  return undefined
}

function writeJson(res: ServerResponse, outcome: { status: number; body: unknown }): void {
  res.writeHead(outcome.status, { 'content-type': 'application/json' }).end(JSON.stringify(outcome.body))
}

async function tokenOf(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { token?: unknown }
    return typeof parsed.token === 'string' ? parsed.token.trim() : undefined
  } catch {
    // A body that is not JSON carries no token; the caller answers 400.
    return undefined
  }
}

/**
 * Mount the routes once a web server is composed.
 * @param ctx - the plugin context.
 * @param runtime - the operations the routes perform.
 */
export function installTelegramRoutes(ctx: Context, runtime: TelegramRoutesRuntime): void {
  ctx.inject(['webServer'], (webCtx) => {
    const mount = (path: string, methods: readonly string[], handler: Handler): void => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          const refusal = refusalOf(req, methods)
          if (refusal === undefined) {
            await handler(req, res)
            return
          }
          res.writeHead(refusal.status, { 'content-type': 'text/plain' }).end(refusal.text)
        },
      }), `idealize-telegram: ${path}`)
    }

    mount(STATUS_PATH, ['GET'], async (_req, res) => {
      writeJson(res, { status: 200, body: await runtime.status() })
    })

    mount(TOKEN_PATH, ['POST'], async (req, res) => {
      const token = await tokenOf(req)
      writeJson(res, token === undefined
        ? { status: 400, body: { error: 'send {"token": "..."}; an empty token removes the stored one' } }
        : await runtime.setToken(token))
    })

    mount(PAIR_PATH, ['POST', 'DELETE'], async (req, res) => {
      writeJson(res, req.method === 'POST' ? await runtime.pair() : await runtime.unpair())
    })
  })
}
