/**
 * The onboarding routes: the agents step's detection and the OpenRouter key
 * save. Both are loopback-fenced; the mutation demands the `x-idealize-auth`
 * header, matching every other `/idealize/*` mutation.
 *
 * - `GET  /idealize/onboarding/agents` — `{ claudeCode: { installed, path? },
 *   openrouter: { connected } }`. Claude Code detection reuses the subprocess
 *   seam's executable resolution (the same call subagent-claude-code starts
 *   runs with); a miss throws there, so detection is resolve-and-catch.
 * - `POST /idealize/onboarding/openrouter` `{ apiKey }` — verify the key
 *   against OpenRouter's models listing BEFORE anything persists, then store
 *   the credential and bind the `openrouter` provider route to it. The route
 *   is a pi-ai catalog provider: the profile needs only `apiKeyEnv`, the
 *   smallest write that makes the stored credential the one requests use
 *   (without it the route falls back to pi-ai's ambient env discovery).
 *
 * @module @idealize/onboarding/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
// Type-only: the `webServer` Context merge the routes register on.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Type-only: the `subprocess` Context merge (claude executable resolution).
import type {} from '@deepseek-ai/dsh-subprocess'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The credential reference the OpenRouter save stores and the detection reads. */
export const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY'

/** The llm-pi-ai settings section (that plugin owns the schema; restated here). */
const LLM_NS = settingsNamespace('llm-pi-ai')

/** The credential reference as the credentials seam brands it. */
const OPENROUTER_KEY_REF = credentialRef(OPENROUTER_KEY_ENV)

/* jscpd:ignore-start */
// The wire helpers mirror @idealize/setup's route module; each package serves
// its own routes and there is no shared host-side http kit to extract into.
function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating = false): boolean {
  /* v8 ignore next -- a served HTTP/1.1 request always carries a Host header; the guard only types the read. */
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
/* jscpd:ignore-end */

/**
 * Twin of `normalizeApiKey` in `@deepseek-ai/dsh-llm` (mirrored by
 * `LEGAL_API_KEY` in `dsh-client-ui-settings-models`): printable ASCII, space
 * excluded. Keep the three in step.
 */
const LEGAL_API_KEY = /^[\x21-\x7E]+$/

/** The key-verification verdict; the failing half carries the response's status and plain reason. */
type KeyVerification = { ok: true } | { ok: false; status: number; error: string }

/**
 * Verify one key with OpenRouter's models listing — the cheapest authenticated
 * call the API offers. A rejected key answers 400; an unreachable or
 * misbehaving endpoint answers 502. Nothing is persisted on either.
 * @param baseURL - the OpenRouter API base (Config-owned).
 * @param apiKey - the key to verify.
 * @returns the verdict.
 */
async function verifyOpenRouterKey(baseURL: string, apiKey: string): Promise<KeyVerification> {
  let response: Response
  try {
    response = await fetch(`${baseURL}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    /* v8 ignore next -- fetch rejects with an Error; the cast only types a thrown non-Error. */
    return { ok: false, status: 502, error: `Could not reach OpenRouter (${error instanceof Error ? error.message : String(error)})` }
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, status: 400, error: 'OpenRouter rejected that key — check it and try again.' }
  }
  if (!response.ok) {
    return { ok: false, status: 502, error: `OpenRouter answered HTTP ${String(response.status)} instead of a model list` }
  }
  return { ok: true }
}

/**
 * Mount the onboarding routes while the web server, settings, credentials, and
 * subprocess services are composed.
 * @param ctx - the plugin context.
 * @param openrouterBaseURL - the OpenRouter API base URL (Config-owned).
 */
export function installOnboardingRoutes(ctx: Context, openrouterBaseURL: string): void {
  ctx.inject(['webServer', 'settings', 'credentials', 'subprocess'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/onboarding/agents',
      handler: async (req, res) => {
        if (refuse(req, res)) return
        // The seam throws on a miss ("was not found on PATH"); a detection
        // route turns that into the installed flag rather than an error.
        const claudePath = await webCtx.subprocess.resolveExecutable('claude', {})
          .then(path => path, () => undefined)
        const stored = await webCtx.credentials.resolve(OPENROUTER_KEY_REF).catch(() => undefined)
        sendJson(res, 200, {
          claudeCode: claudePath === undefined ? { installed: false } : { installed: true, path: claudePath },
          openrouter: { connected: stored !== undefined && stored.value.length > 0 },
        })
      },
    }), 'idealize-onboarding: agents route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: '/idealize/onboarding/openrouter',
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
          return
        }
        if (refuse(req, res, true)) return
        let body: { apiKey?: unknown }
        try {
          body = JSON.parse(await readBody(req)) as typeof body
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid JSON' })
          return
        }
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        if (apiKey === '') {
          sendJson(res, 400, { ok: false, error: 'apiKey must be a non-empty string' })
          return
        }
        if (!LEGAL_API_KEY.test(apiKey)) {
          sendJson(res, 400, { ok: false, error: 'apiKey contains characters an API key cannot carry' })
          return
        }
        const verification = await verifyOpenRouterKey(openrouterBaseURL, apiKey)
        if (!verification.ok) {
          sendJson(res, verification.status, { ok: false, error: verification.error })
          return
        }
        if (webCtx.settings.get(LLM_NS) === undefined) {
          sendJson(res, 500, { ok: false, error: 'the llm-pi-ai settings section is not registered — is llm-pi-ai composed?' })
          return
        }
        await webCtx.credentials.set(OPENROUTER_KEY_REF, apiKey)
        // The catalog route's only configuration: which credential it resolves.
        await webCtx.settings.update(LLM_NS, {
          providers: { openrouter: { displayName: 'OpenRouter', apiKeyEnv: OPENROUTER_KEY_ENV } },
        })
        sendJson(res, 200, { ok: true })
      },
    }), 'idealize-onboarding: openrouter route')
  })
}
