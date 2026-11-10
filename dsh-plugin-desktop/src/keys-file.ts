/**
 * The `.idealizekeys` file: how an organisation hands its API keys to a
 * person in one action. Double-clicking the file opens IDEalize (Launch
 * Services knows the extension from `build.fileAssociations`), and the app
 * posts the document to `POST /idealize/brains/services/import`, which
 * stores every key where its service keeps it. The host owns what a keys
 * file may say; this module only recognises the file, reads it within a size
 * cap, and reports what the host connected or why it refused.
 *
 * Whoever holds the file holds the keys. It is neither encrypted nor kept.
 */

import { basename } from 'node:path'
import {
  keysFileCredentials,
  keysFileGateway,
  keysFileQuestion,
  type AskConfirmation,
  type ServiceSummary,
} from './open-confirmation.ts'
import { fileFromArgv } from './opened-file.ts'

/** The extension Launch Services and the argument scan recognise. */
export const KEYS_FILE_EXTENSION = '.idealizekeys'

/** The most bytes a keys file may hold; a larger file is not a keys file. */
export const KEYS_FILE_MAX_BYTES = 64 * 1024

/** The host route a keys file is posted to, by the shell and the Brains pane alike. */
export const KEYS_FILE_ROUTE = '/idealize/brains/services/import'

/**
 * Whether a path names a keys file, by extension alone.
 * @param path - the path the operating system handed over.
 * @returns true for a `.idealizekeys` path in any letter case.
 */
export function isKeysFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(KEYS_FILE_EXTENSION)
}

/**
 * The first keys file in a process argument list, which is how Windows and
 * Linux deliver a double-clicked file (macOS uses the `open-file` event).
 * @param argv - the argument list, as given to `second-instance` or `process.argv`.
 * @returns the path, or undefined when the list carries none.
 */
export function keysFileFromArgv(argv: readonly string[]): string | undefined {
  return fileFromArgv(argv, isKeysFilePath)
}

/** The outcome of one import, in the words the notification shows. */
export type KeysFileOutcome =
  | { ok: true; connected: string[] }
  | { ok: false; reason: string }

/** What one import needs from the shell. */
export interface KeysFileImport {
  /** The file's path. */
  path: string
  /** The port the plugin Host listens on, loopback. */
  port: number
  /** Read the file as text. */
  readFile: (path: string) => Promise<string>
  /** This launch's token, which the Host's launch gate requires of the main process. */
  launchKey?: string
  /** Perform the request; Electron's `net.fetch` in the app, a stub in tests. */
  request: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
  }>
}

/**
 * Post one keys file to the host and say what happened.
 * @param options - the file, the host port, and the shell's file and network access.
 * @returns the services connected, or the reason the file was refused.
 */
export async function importKeysFile(options: KeysFileImport): Promise<KeysFileOutcome> {
  let text: string
  try {
    text = await options.readFile(options.path)
  } catch (cause) {
    return { ok: false, reason: `could not read the file: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  if (Buffer.byteLength(text, 'utf8') > KEYS_FILE_MAX_BYTES) {
    return { ok: false, reason: `the file is larger than a keys file (${String(KEYS_FILE_MAX_BYTES)} bytes at most)` }
  }
  let response: Awaited<ReturnType<KeysFileImport['request']>>
  try {
    response = await options.request(`http://127.0.0.1:${String(options.port)}${KEYS_FILE_ROUTE}`, {
      method: 'POST',
      headers: {
        'x-idealize-auth': '1',
        'content-type': 'application/json',
        ...options.launchKey === undefined ? {} : { 'x-idealize-key': options.launchKey },
      },
      body: text,
    })
  } catch (cause) {
    return { ok: false, reason: `the app could not be reached: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  let body: { error?: unknown; connected?: unknown } | undefined
  try {
    body = await response.json() as typeof body
  } catch {
    // A non-JSON answer (the loopback fence's plain-text refusal) carries no
    // reason to show; the status stands in below.
    body = undefined
  }
  // A refusal is a refusal whatever its status: a gateway's unreadable answer once came back as 200 with an error,
  // and the notification said the keys were connected.
  if (!response.ok || typeof body?.error === 'string') {
    const reason = typeof body?.error === 'string' ? body.error : `the app answered ${String(response.status)}`
    return { ok: false, reason }
  }
  const connected = Array.isArray(body?.connected)
    ? (body.connected as { name?: unknown }[]).map(row => typeof row.name === 'string' ? row.name : '').filter(name => name !== '')
    : []
  return { ok: true, connected }
}

/** The Host route that lists services, which names what a keys file would change. */
const SERVICES_ROUTE = '/idealize/brains/services'

/** What asking first adds to one import. */
export interface ConfirmedKeysFileImport extends KeysFileImport {
  /** Put the question to the person. */
  ask: AskConfirmation
  /** Read the Host's list of services; replaced in tests. */
  listServices?: () => Promise<readonly ServiceSummary[] | undefined>
  /** Read the address of the gateway already connected; replaced in tests. */
  currentGateway?: () => Promise<string | undefined>
}

/** The gateway already connected, which a keys file carrying one would replace. */
export async function hostGateway(options: Pick<KeysFileImport, 'port' | 'launchKey' | 'request'>): Promise<string | undefined> {
  try {
    const response = await options.request(`http://127.0.0.1:${String(options.port)}/idealize/brains/gateway`, {
      method: 'GET',
      headers: { 'x-idealize-auth': '1', ...options.launchKey === undefined ? {} : { 'x-idealize-key': options.launchKey } },
    })
    if (!response.ok) return undefined
    const address = (await response.json() as { address?: unknown } | null)?.address
    return typeof address === 'string' && address !== '' ? address : undefined
  } catch {
    return undefined
  }
}

async function hostServices(options: KeysFileImport): Promise<readonly ServiceSummary[] | undefined> {
  try {
    const response = await options.request(`http://127.0.0.1:${String(options.port)}${SERVICES_ROUTE}`, {
      method: 'GET',
      headers: {
        'x-idealize-auth': '1',
        ...options.launchKey === undefined ? {} : { 'x-idealize-key': options.launchKey },
      },
    })
    if (!response.ok) return undefined
    const body = await response.json() as { services?: readonly ServiceSummary[] }
    return Array.isArray(body.services) ? body.services : undefined
  } catch {
    return undefined
  }
}

/**
 * Show what a keys file would change, then import exactly the text the person
 * was shown. Text that is no keys file goes straight on, because the route
 * refuses it and nothing changes.
 * @param options - the import, and how to ask.
 * @returns the outcome, or undefined when the person cancelled.
 */
export async function confirmAndImportKeysFile(options: ConfirmedKeysFileImport): Promise<KeysFileOutcome | undefined> {
  let text: string
  try {
    text = await options.readFile(options.path)
  } catch (cause) {
    return { ok: false, reason: `could not read the file: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
  const credentials = Buffer.byteLength(text, 'utf8') > KEYS_FILE_MAX_BYTES ? undefined : keysFileCredentials(text)
  if (credentials !== undefined) {
    const services = await (options.listServices ?? (() => hostServices(options)))()
    const address = keysFileGateway(text)
    const current = address === undefined ? undefined : await (options.currentGateway ?? (() => hostGateway(options)))()
    const gateway = address === undefined ? undefined : { address, ...current === undefined ? {} : { current } }
    if (!await options.ask(keysFileQuestion(basename(options.path), credentials, services, gateway))) return undefined
  }
  return await importKeysFile({ ...options, readFile: async () => text })
}

/**
 * The notification an outcome raises: the services connected, or what to do
 * about the refusal.
 * @param outcome - the import's outcome.
 * @returns the title and body to show.
 */
export function keysFileNotification(outcome: KeysFileOutcome): { title: string; body: string } {
  if (outcome.ok) {
    return outcome.connected.length === 0
      ? { title: 'Keys file read', body: 'It named no service this app connects.' }
      : { title: 'Keys connected', body: `${outcome.connected.join(', ')} ready to use. Open Brains to check.` }
  }
  return { title: 'Keys file not applied', body: outcome.reason }
}
