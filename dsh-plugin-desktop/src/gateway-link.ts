/**
 * One-tap connect for a key gateway. The gateway's Connect button opens
 * `idealize://gateway?address=…&code=…`. The link carries a one-time code,
 * never the key, so the key stays out of browser history. After the person
 * agrees, the app exchanges the code at `POST <address>/v1/pair` for the key,
 * then stores the address and key through the keys-file import, which checks
 * the key with the gateway before it stores anything.
 */

import type { ConnectGatewayRequest } from './idealize-url.ts'
import { hostGateway, importKeysFile, type KeysFileImport, type KeysFileOutcome } from './keys-file.ts'
import { gatewayLinkQuestion, type AskConfirmation } from './open-confirmation.ts'

/** How long the code exchange may take before the app stops waiting. */
export const PAIR_TIMEOUT_MS = 15_000

/** What one link needs from the shell. */
export interface GatewayLinkConnect {
  /** The parsed link. */
  link: ConnectGatewayRequest
  /** Put the question to the person. */
  ask: AskConfirmation
  /** The port the plugin Host listens on, loopback. */
  port: number
  /** This launch's token, which the Host's launch gate requires of the main process. */
  launchKey?: string
  /** Reach the gateway; Electron's `net.fetch` in the app, a stub in tests. */
  fetchGateway: (url: string, init: {
    method: string
    headers: Record<string, string>
    body: string
    credentials: 'omit'
    redirect: 'error'
    signal?: AbortSignal
  }) => Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
  }>
  /** Reach the Host, as the keys-file import does. */
  request: KeysFileImport['request']
}

/** The words a gateway put in a refusal, in the shapes gateways use. */
function refusalWords(body: unknown): string | undefined {
  const value = body as { error?: unknown; detail?: unknown; message?: unknown } | null
  if (typeof value?.error === 'string') return value.error
  const nested = (value?.error as { message?: unknown } | undefined)?.message
  if (typeof nested === 'string') return nested
  if (typeof value?.detail === 'string') return value.detail
  return typeof value?.message === 'string' ? value.message : undefined
}

/**
 * Ask, claim the code and store the gateway.
 * @param options - the link, how to ask, and the shell's network access.
 * @returns the outcome, or undefined when the person cancelled.
 */
export async function connectGatewayLink(options: GatewayLinkConnect): Promise<KeysFileOutcome | undefined> {
  const { address, code } = options.link
  if (!await options.ask(gatewayLinkQuestion(address, await hostGateway(options)))) return undefined
  let response: Awaited<ReturnType<GatewayLinkConnect['fetchGateway']>>
  try {
    response = await options.fetchGateway(`${address}/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code }),
      // The app's session holds the cookie that opens its own local server. This request goes to an address a link
      // chose, so it carries no cookies and follows no redirect to somewhere the person was never shown.
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
    })
  } catch {
    return { ok: false, reason: 'The gateway did not answer. Press Connect in the gateway again.' }
  }
  const body = await response.json().catch(() => undefined)
  if (!response.ok) {
    return { ok: false, reason: refusalWords(body) ?? `The gateway answered ${String(response.status)}. Press Connect in the gateway again.` }
  }
  const key = (body as { key?: unknown } | undefined)?.key
  if (typeof key !== 'string' || key.trim() === '') return { ok: false, reason: 'The gateway sent no key. Press Connect in the gateway again.' }
  // The address the person agreed to is the one stored, whatever the reply says.
  const file = JSON.stringify({ format: 1, credentials: { GATEWAY_URL: address, GATEWAY_API_KEY: key.trim() } })
  return await importKeysFile({
    path: 'gateway link',
    port: options.port,
    ...options.launchKey === undefined ? {} : { launchKey: options.launchKey },
    readFile: async () => file,
    request: options.request,
  })
}

/**
 * The notification an outcome raises.
 * @param address - the gateway the link named.
 * @param outcome - the connect's outcome.
 * @returns the title and body to show.
 */
export function gatewayLinkNotification(address: string, outcome: KeysFileOutcome): { title: string; body: string } {
  let host = address
  try {
    host = new URL(address).host
  } catch {
    // Shown as given.
  }
  return outcome.ok
    ? { title: 'Key gateway connected', body: `${host} is connected. Open Brains to see what it reaches.` }
    : { title: 'Key gateway not connected', body: outcome.reason }
}
