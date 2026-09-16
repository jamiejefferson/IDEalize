/** The Settings row's calls to the host routes. */

import type { TelegramStatus } from '../settings.ts'

/**
 * Call one Telegram route.
 * @param method - `GET` reads; the others mutate and carry the auth header.
 * @param path - the route.
 * @param body - the JSON body.
 * @returns the status the route answers.
 */
export async function telegramCall(method: 'GET' | 'POST' | 'DELETE', path: string, body?: object): Promise<TelegramStatus> {
  const response = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'content-type': 'application/json', 'x-idealize-auth': '1' },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  })
  const json = await response.json() as TelegramStatus | { error: string }
  if (!response.ok) throw new Error('error' in json ? json.error : `HTTP ${response.status}`)
  return json as TelegramStatus
}
