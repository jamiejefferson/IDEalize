/**
 * @idealize/provider-pack — the login-first auth substrate.
 *
 * Provides `ctx.idealizeOAuth`: a persistent pi-ai credential store under the
 * Harness home plus provider-owned OAuth login/logout orchestration. The
 * llm-pi-ai adapter (this fork) builds its Models collections over the same
 * store, so a credential stored here authenticates ordinary session requests
 * for OAuth routes such as `openai-codex`.
 *
 * When the webserver is composed the pack also registers the sign-in surface:
 *
 * - `GET  /idealize/signin`          — minimal branded page listing OAuth providers
 * - `GET  /idealize/auth/providers`  — provider ids, labels, stored/pending state
 * - `POST /idealize/auth/login`      — `?provider=` starts the flow, returns `{ authUrl }`
 * - `GET  /idealize/auth/status`     — `?provider=` reports pending/stored/error
 * - `POST /idealize/auth/logout`     — `?provider=` deletes the stored credential
 *
 * Mutating endpoints demand the `x-idealize-auth: 1` header (a cross-origin
 * page cannot attach custom headers without a CORS preflight the server never
 * grants) and every endpoint refuses a non-loopback Host, which closes DNS
 * rebinding. Full integration with the web app's token fence is queued work.
 *
 * @module @idealize/provider-pack
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { startOAuthLogin } from './oauth-login.ts'
import { pendingFields } from './pending.ts'
import type { PendingLogin } from './pending.ts'
import { FileCredentialStore, oauthStorePath } from './store.ts'
import { signinPage } from './signin-page.ts'

export { noteAuthEvent } from './pending.ts'
export type { PendingLogin } from './pending.ts'
export { FileCredentialStore, OAUTH_STORE_FILENAME, oauthStorePath } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeOAuth: IdealizeOAuth
  }
}

/** What the providers endpoint reports per OAuth-capable catalog provider. */
export interface OAuthProviderStatus {
  id: string
  name: string
  loginLabel?: string
  /**
   * True when sign-in is the only way this route authenticates: its catalog
   * provider declares no API-key method, so a pasted key can never serve it
   * (`openai-codex` sends a ChatGPT token, not a key). A route offering both,
   * such as kimi-coding, is false and keeps taking keys.
   */
  keyless: boolean
  stored: boolean
  pending: boolean
  /** While a device-code login is pending: the code the provider's page may ask the person to type. */
  userCode?: string
  error?: string
}

/** Subscription sign-in behind `ctx.idealizeOAuth`: stored OAuth credentials and in-flight logins. */
export class IdealizeOAuth extends Service {
  /** The stored OAuth credentials, shared with the pi-ai adapter. */
  readonly store: FileCredentialStore
  private readonly pending = new Map<string, PendingLogin>()

  constructor(ctx: Context) {
    super(ctx, 'idealizeOAuth')
    this.store = new FileCredentialStore(oauthStorePath(resolveDshHome()))
  }

  /**
   * Every installed catalog provider whose auth offers OAuth — minus the
   * withheld ones. Anthropic's flow ships in pi-ai but subscription use in
   * third-party agents is barred by its terms today (scope decision 3: key
   * only, standing investigation); offering the button would invite a
   * violation, so it is withheld here rather than hidden downstream.
   * @returns each offered provider's id, display name, whether sign-in is its only auth, and optional login label.
   */
  oauthProviders(): { id: string; name: string; keyless: boolean; loginLabel?: string }[] {
    const withheld = new Set(['anthropic'])
    return builtinProviders()
      .filter(provider => provider.auth.oauth !== undefined && !withheld.has(provider.id))
      .map(provider => ({
        id: provider.id,
        name: provider.name,
        keyless: provider.auth.apiKey === undefined,
        ...provider.auth.oauth?.loginLabel === undefined
          ? {}
          : { loginLabel: provider.auth.oauth.loginLabel },
      }))
  }

  /**
   * Current status for the sign-in surface.
   * @returns one row per offered provider: stored, pending, and last error.
   */
  async status(): Promise<OAuthProviderStatus[]> {
    const stored = new Set((await this.store.list()).map(info => info.providerId))
    return this.oauthProviders().map(provider => ({
      ...provider,
      stored: stored.has(provider.id),
      ...pendingFields(this.pending.get(provider.id)),
    }))
  }

  /**
   * Start (or join) one provider's login flow. Resolves with the authorize
   * URL as soon as the flow surfaces it; the flow itself continues until the
   * local callback settles it, after which pi-ai has persisted the credential
   * into the store.
   * @param providerId - a catalog provider with OAuth auth.
   * @returns the URL the user's browser must open.
   */
  login(providerId: string): Promise<string> {
    return startOAuthLogin(this.store, this.pending, providerId)
  }

  /**
   * Delete one provider's stored credential and clear its attempt record.
   * @param providerId - The provider to sign out of.
   */
  async logout(providerId: string): Promise<void> {
    this.pending.delete(providerId)
    await this.store.delete(providerId)
  }
}

/** Loopback-only + custom-header fence for the sign-in endpoints. */
function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const host = req.headers.host ?? ''
  const hostname = host.replace(/:\d+$/, '')
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function providerParam(req: IncomingMessage): string | undefined {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const provider = url.searchParams.get('provider')
  return provider === null || provider === '' ? undefined : provider
}

/** Provide the service, and the sign-in surface when the webserver is composed. */
export function apply(ctx: Context): void {
  ctx.plugin(IdealizeOAuth)
  ctx.inject(['idealizeOAuth', 'webServer'], (webCtx) => {
    const oauth = webCtx.idealizeOAuth
    const routes: { path: string; mutating: boolean; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }[] = [
      {
        path: '/idealize/signin',
        mutating: false,
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(signinPage())
        },
      },
      {
        path: '/idealize/auth/providers',
        mutating: false,
        handler: async (_req, res) => { sendJson(res, 200, await oauth.status()) },
      },
      {
        path: '/idealize/auth/login',
        mutating: true,
        handler: async (req, res) => {
          const provider = providerParam(req)
          if (provider === undefined) {
            sendJson(res, 400, { error: 'provider query parameter required' })
            return
          }
          try {
            sendJson(res, 200, { authUrl: await oauth.login(provider) })
          } catch (error) {
            /* v8 ignore next -- every rejection the login driver raises is an Error; the cast only types a third-party throw. */
            sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        },
      },
      {
        path: '/idealize/auth/status',
        mutating: false,
        handler: async (req, res) => {
          const provider = providerParam(req)
          const statuses = await oauth.status()
          sendJson(res, 200, provider === undefined
            ? statuses
            : statuses.find(status => status.id === provider) ?? { error: 'unknown provider' })
        },
      },
      {
        path: '/idealize/auth/logout',
        mutating: true,
        handler: async (req, res) => {
          const provider = providerParam(req)
          if (provider === undefined) {
            sendJson(res, 400, { error: 'provider query parameter required' })
            return
          }
          await oauth.logout(provider)
          sendJson(res, 200, { ok: true })
        },
      },
    ]
    for (const route of routes) {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path: route.path,
          handler: async (req, res) => {
            if (refuse(req, res, route.mutating)) return
            await route.handler(req, res)
          },
        }),
        `provider-pack: ${route.path}`,
      )
    }
  })
}
