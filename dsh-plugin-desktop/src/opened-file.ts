/**
 * A file the operating system opens with IDEalize. The manifest's
 * `fileAssociations` teaches Launch Services and the Windows registry the
 * extensions, so the app appears under Finder's and Explorer's "Open with";
 * choosing it hands the path over as an `open-file` event on macOS and as a
 * process argument elsewhere. Today one document kind rides this way, the
 * Markdown file (feedback 9583834d, 24 Sep 2026: "tried to set-up md files to
 * open in idealize but it didn't work"): the window shows it in the deck's
 * file viewer. The keys file has its own module because it is imported, not
 * shown; the argument scan here serves both.
 */

import { dirname, join, sep } from 'node:path'

/** The extensions Launch Services and the argument scan recognise as Markdown. */
export const MARKDOWN_FILE_EXTENSIONS = ['.md', '.markdown'] as const

/** The bridge event the main process pushes for a file the window is to show. */
export interface OpenFileEvent {
  kind: 'open-file'
  title: 'Open'
  /** The file's path, for the feed's human line. */
  body: string
  /** The absolute file the window is to show in the viewer. */
  file: string
  /** The folder to register as a project first, when the viewer's fence would refuse the file bare. */
  folder?: string
}

/**
 * The first argument a recogniser accepts, which is how Windows and Linux
 * deliver a double-clicked file (macOS uses the `open-file` event).
 * @param argv - the argument list, as given to `second-instance` or `process.argv`.
 * @param matches - whether one argument names the file kind wanted.
 * @returns the path, or undefined when the list carries none.
 */
export function fileFromArgv(argv: readonly string[], matches: (argument: string) => boolean): string | undefined {
  return argv.find(argument => matches(argument))
}

/**
 * Whether a path names a Markdown file, by extension alone.
 * @param path - the path the operating system handed over.
 * @returns true for a `.md` or `.markdown` path in any letter case.
 */
export function isMarkdownFilePath(path: string): boolean {
  const lower = path.toLowerCase()
  return MARKDOWN_FILE_EXTENSIONS.some(extension => lower.endsWith(extension))
}

/**
 * The first Markdown file in a process argument list.
 * @param argv - the argument list, as given to `second-instance` or `process.argv`.
 * @returns the path, or undefined when the list carries none.
 */
export function markdownFileFromArgv(argv: readonly string[]): string | undefined {
  return fileFromArgv(argv, isMarkdownFilePath)
}

/** What deciding a file's project folder needs from the shell. */
export interface ProjectFolderLookup {
  /** The person's home folder, which the viewer serves without a project. */
  home: string
  /** Whether a path exists, in any form. */
  exists: (path: string) => boolean
}

/**
 * Whether one path lies inside a folder, by path prefix. Windows paths compare
 * without case, as the file system does.
 * @param path - the absolute path in question.
 * @param folder - the absolute folder.
 * @returns true when the path is the folder or sits under it.
 */
function inside(path: string, folder: string): boolean {
  const fold = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const root = fold(folder).replace(/[\\/]+$/, '')
  const candidate = fold(path)
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

/**
 * The folder to register as a project before a file can be shown, or nothing
 * when none is needed. The viewer serves any file under the person's home
 * folder as it is; a file elsewhere (an external volume, a shared drive) sits
 * outside that fence, so its repository, or failing that its own folder,
 * becomes a project first, the way Finder's "Idealize this" would make it.
 * @param file - the absolute file, symlinks already resolved.
 * @param lookup - the home folder and a way to test for a `.git` entry.
 * @returns the git top level holding the file, else the file's folder, else undefined for a file under home.
 */
export function projectFolderFor(file: string, lookup: ProjectFolderLookup): string | undefined {
  if (inside(file, lookup.home)) return undefined
  const own = dirname(file)
  let folder = own
  for (;;) {
    // A worktree keeps `.git` as a file that points at the main repository,
    // so presence is what counts, not the entry's kind.
    if (lookup.exists(join(folder, '.git'))) return folder
    const parent = dirname(folder)
    if (parent === folder) return own
    folder = parent
  }
}

/**
 * The bridge event that asks the window to show one file.
 * @param file - the absolute file, symlinks already resolved.
 * @param folder - the project folder to register first, when there is one.
 * @returns the event, ready for the bridge buffer.
 */
export function openFileEvent(file: string, folder: string | undefined): OpenFileEvent {
  return { kind: 'open-file', title: 'Open', body: file, file, ...folder === undefined ? {} : { folder } }
}
