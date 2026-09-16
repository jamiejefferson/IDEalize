/**
 * One provider's live login attempt, and what a pi-ai auth event puts into it.
 * @module @idealize/provider-pack/src/pending
 */

import type { AuthEvent } from '@earendil-works/pi-ai'

/** One provider's live login attempt. */
export interface PendingLogin {
  /** The page the person's browser opens: an authorize URL, or a device flow's verification page. */
  authUrl?: string
  /** A device flow's user code, shown beside the URL in case the page asks for it. */
  userCode?: string
  error?: string
  done: boolean
  settled: Promise<void>
}

/**
 * Record what a login flow surfaces. Browser flows (`openai-codex`,
 * `openrouter`) raise `auth_url`; device-code flows (Kimi Code) raise
 * `device_code` with a verification page whose URL carries the code, and
 * never an `auth_url`. Both are the page the person must open, so both settle
 * `authUrl`; the device code is kept beside it for the sign-in page to show.
 * @param record - the attempt to write into.
 * @param event - the event the flow raised.
 * @returns the URL to hand to the browser, when the event carried one.
 */
export function noteAuthEvent(record: PendingLogin, event: AuthEvent): string | undefined {
  if (event.type === 'auth_url') {
    record.authUrl = event.url
    return event.url
  }
  if (event.type === 'device_code') {
    record.authUrl = event.verificationUri
    record.userCode = event.userCode
    return event.verificationUri
  }
  return undefined
}


/**
 * How one provider's live attempt reads on the sign-in surface.
 * @param attempt - the provider's attempt, or `undefined` if none was started.
 * @returns whether a login is in flight, the device code to show while it is,
 * and the last error the flow reported.
 */
export function pendingFields(attempt: PendingLogin | undefined): { pending: boolean; userCode?: string; error?: string } {
  const inFlight = attempt !== undefined && !attempt.done
  return {
    pending: inFlight,
    ...inFlight && attempt.userCode !== undefined ? { userCode: attempt.userCode } : {},
    ...attempt?.error === undefined ? {} : { error: attempt.error },
  }
}
