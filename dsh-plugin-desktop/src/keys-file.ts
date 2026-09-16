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
  return argv.find(argument => isKeysFilePath(argument))
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
  /** Perform the request; Electron's `net.fetch` in the app, a stub in tests. */
  request: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
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
      headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' },
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
  if (!response.ok) {
    const reason = typeof body?.error === 'string' ? body.error : `the app answered ${String(response.status)}`
    return { ok: false, reason }
  }
  const connected = Array.isArray(body?.connected)
    ? (body.connected as { name?: unknown }[]).map(row => typeof row.name === 'string' ? row.name : '').filter(name => name !== '')
    : []
  return { ok: true, connected }
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
