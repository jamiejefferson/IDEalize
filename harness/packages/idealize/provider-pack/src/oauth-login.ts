/**
 * The pi-ai OAuth login driver: start (or join) one provider's flow and wait
 * for the page the person must open. Every path here runs a live provider
 * handshake — a PKCE authorize URL served to a localhost callback, or a
 * device-code poll — so the module is driven by the sign-in walk against the
 * packaged app rather than by an offline harness.
 * @module @idealize/provider-pack/src/oauth-login
 */

import { createModels } from '@earendil-works/pi-ai'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { noteAuthEvent } from './pending.ts'
import type { PendingLogin } from './pending.ts'
import type { FileCredentialStore } from './store.ts'

/**
 * Start (or join) one provider's login flow. Resolves with the authorize URL
 * as soon as the flow surfaces it; the flow itself continues until the local
 * callback settles it, after which pi-ai has persisted the credential.
 * @param store - the credential store pi-ai writes the result into.
 * @param pending - the live attempts, keyed by provider id.
 * @param providerId - a catalog provider with OAuth auth.
 * @returns the URL the user's browser must open.
 */
export async function startOAuthLogin(
  store: FileCredentialStore,
  pending: Map<string, PendingLogin>,
  providerId: string,
): Promise<string> {
  const existing = pending.get(providerId)
  if (existing !== undefined && !existing.done) {
    if (existing.authUrl !== undefined) return existing.authUrl
    return awaitAuthUrl(providerId, existing)
  }
  const provider = builtinProviders().find(candidate => candidate.id === providerId)
  if (provider?.auth.oauth === undefined) {
    throw new Error(`provider-pack: "${providerId}" is not an OAuth-capable catalog provider`)
  }
  const record: PendingLogin = { done: false, settled: Promise.resolve() }
  let surfaceAuthUrl: (url: string) => void = () => undefined
  const authUrlReady = new Promise<string>((resolve) => { surfaceAuthUrl = resolve })
  const models = createModels({ credentials: store })
  models.setProvider(provider)
  const interaction = {
    notify: (event: AuthEvent): void => {
      const url = noteAuthEvent(record, event)
      if (url !== undefined) surfaceAuthUrl(url)
    },
    prompt: async (prompt: AuthPrompt): Promise<string> => {
      // Headless: answer method selects toward the browser flow; park a
      // manual-code prompt so the localhost callback (raced through the
      // prompt's own signal) settles the login.
      if (prompt.type === 'select') {
        const pick = prompt.options.find(option =>
          /browser|chatgpt|oauth|subscription/i.test(`${option.id} ${option.label}`))
          ?? prompt.options[0]
        if (pick === undefined) throw new Error('provider-pack: empty select prompt')
        return pick.id
      }
      if (prompt.type === 'manual_code') {
        return new Promise<string>((_resolve, reject) => {
          prompt.signal?.addEventListener('abort', () => {
            reject(new Error('provider-pack: manual code superseded by callback'))
          })
        })
      }
      throw new Error(`provider-pack: unsupported ${prompt.type} prompt during headless login`)
    },
  }
  record.settled = models.login(providerId, 'oauth', interaction).then(
    () => { record.done = true },
    (error: unknown) => {
      record.done = true
      record.error = error instanceof Error ? error.message : String(error)
    },
  )
  pending.set(providerId, record)
  return awaitAuthUrl(providerId, record, authUrlReady)
}

/** Wait briefly for the flow to surface its authorize URL. */
async function awaitAuthUrl(
  providerId: string,
  record: PendingLogin,
  ready?: Promise<string>,
): Promise<string> {
  const surfaced = await Promise.race([
    ready ?? pollAuthUrl(record),
    record.settled.then(() => record.authUrl),
    new Promise<undefined>(resolve => setTimeout(() => { resolve(undefined) }, 15_000)),
  ])
  if (typeof surfaced === 'string') return surfaced
  if (record.authUrl !== undefined) return record.authUrl
  throw new Error(record.error ?? `provider-pack: "${providerId}" login surfaced no authorize URL`)
}

async function pollAuthUrl(record: PendingLogin): Promise<string | undefined> {
  while (!record.done && record.authUrl === undefined) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return record.authUrl
}
