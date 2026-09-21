/**
 * The `idealize://` URL scheme, which exists so surfaces outside the app can
 * ask it to do one thing. Today there is one request: `idealize://project?path=…`
 * opens a folder as a project, sent by the Finder Quick Action this app
 * installs (JJ, 13 Sep 2026: "right-click menu on folders should include
 * 'Idealize this' which opens it as a project").
 *
 * Windows Explorer sends the same request as a command-line switch,
 * `--idealize-project=<folder>`, because a registry verb can only substitute
 * the raw path (`%V`) into a command line and cannot percent-encode it: a
 * folder named `Art & Design #2` would lose everything after the `#` inside a
 * URL (PC test drive, 18 Sep 2026).
 *
 * Anything on the machine can send one of these requests, so a request names a
 * folder and nothing else: no command, no argument the app would run.
 */

/** The scheme the app registers with Launch Services and the Windows registry. */
export const IDEALIZE_SCHEME = 'idealize'

/**
 * The switch Explorer's "Idealize this" verb passes, with the folder after the
 * `=`. `build/installer.nsh` writes the same text into the registry, and
 * `tests/idealize-this.spec.ts` holds the two together.
 */
export const PROJECT_SWITCH = '--idealize-project='

/** A parsed request. One member today; the union is where a second request lands. */
export interface OpenProjectRequest {
  kind: 'open-project'
  /** The absolute folder to register as a Workspace and open. */
  path: string
}

/**
 * Parse one `idealize://` URL.
 * @param url - the URL as the operating system handed it over.
 * @returns the request, or undefined when the URL is not ours, names no known
 * request, or carries no absolute path.
 */
export function parseIdealizeUrl(url: string): OpenProjectRequest | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== `${IDEALIZE_SCHEME}:`) return undefined
  // `idealize://project?path=…` puts "project" in the host, not the pathname.
  const request = parsed.host !== '' ? parsed.host : parsed.pathname.replace(/^\/+/, '')
  if (request !== 'project') return undefined
  return openProject(parsed.searchParams.get('path') ?? '')
}

/** The request for one folder, or undefined when the path is not absolute. */
function openProject(path: string): OpenProjectRequest | undefined {
  // A relative path would resolve against whatever directory the app happens
  // to be in, which is not what the sender meant by any reading.
  if (!path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) return undefined
  return { kind: 'open-project', path }
}

/**
 * Parse one `--idealize-project=<folder>` switch.
 * @param argument - one element of a process argument list.
 * @returns the request, or undefined when the argument is not the switch or
 * carries no absolute path.
 */
export function parseProjectSwitch(argument: string): OpenProjectRequest | undefined {
  if (!argument.startsWith(PROJECT_SWITCH)) return undefined
  // The verb quotes the whole switch, and Windows reads a backslash before the
  // closing quote as an escaped quote, so right-clicking inside a drive root
  // (`%V` is `C:\`) arrives as `C:"`. No Windows path can hold a quote, so a
  // trailing one can only be that backslash.
  return openProject(argument.slice(PROJECT_SWITCH.length).replace(/"$/, '\\'))
}

/**
 * The first request in a process argument list, as an `idealize://` URL or the
 * Explorer switch, which is how Windows and Linux deliver one (macOS uses the
 * `open-url` event instead).
 * @param argv - the argument list, as given to `second-instance` or `process.argv`.
 * @returns the first request found, or undefined when the list carries none.
 */
export function requestFromArgv(argv: readonly string[]): OpenProjectRequest | undefined {
  for (const argument of argv) {
    const request = parseIdealizeUrl(argument) ?? parseProjectSwitch(argument)
    if (request !== undefined) return request
  }
  return undefined
}
