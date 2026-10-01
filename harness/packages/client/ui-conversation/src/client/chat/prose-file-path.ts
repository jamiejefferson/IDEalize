/**
 * The file a prose token names: an assistant message's link destination, or
 * an inline-code token, read as a filesystem path. Whether that file opens
 * anywhere is the caller's business; this only decides what path the text
 * spells.
 */

/**
 * Read one link destination or inline-code token as a path.
 * @param value - The authored destination or token, exactly as written.
 * @returns The path it spells — absolute, `~/`, or relative to the session's
 * folder — or undefined when it names a URL of another scheme, a host other
 * than this machine, or is a relative phrase with spaces (`cat notes.md` is
 * a command, not a file). A `file:` URL becomes its decoded path; a trailing
 * `#fragment`, `?query` or `:line[:column]` is dropped.
 */
export function proseFilePath(value: string): string | undefined {
  const text = value.trim()
  if (text === '' || /[\r\n]/.test(text)) return undefined
  if (/^file:/i.test(text)) return fileUrlPath(text)
  let path = text.replace(/[?#].*$/, '').replace(/:\d+(?::\d+)?$/, '')
  const drive = /^[A-Za-z]:[\\/]/.test(path)
  // Any other scheme (http:, mailto:, vscode:) is a URL, never a file here.
  if (!drive && /^[A-Za-z][A-Za-z\d+.-]*:/.test(path)) return undefined
  // Spaces as written, before decoding: `my%20plan.md` names one file.
  const spaced = /\s/.test(path)
  try {
    path = decodeURIComponent(path)
  } catch {
    // A literal % that is no escape: the path is spelled as written.
  }
  const anchored = drive || /^(?:\/|~\/|\.{1,2}[\\/]|\\\\)/.test(path)
  if (path === '' || (!anchored && spaced)) return undefined
  return path
}

/** A `file:` URL's local path, decoded; undefined for another host or a malformed URL. */
function fileUrlPath(text: string): string | undefined {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return undefined
  }
  if (url.host !== '' && url.host !== 'localhost') return undefined
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    path = url.pathname
  }
  // file:///C:/x reads /C:/x; the drive letter is the path's start on Windows.
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
}
