/**
 * The rail's Notes scratchpad, host half: which Markdown file is the current
 * note, and a fresh one when there is none or a new one is asked for.
 *
 * Notes live in one folder outside every project (JJ, 6 Oct 2026: "saved by
 * default in a general documentation notes space as it would be separate from
 * projects"): `Notes/` inside the documentation vault, or `IDEalize Notes/` in
 * the Documents folder while no vault is set. The current note is remembered
 * in a dotfile beside the notes (hidden from the Files pane, which skips
 * dotfiles), so the same note opens on every tap and across restarts, and a
 * note moved with its folder stays current.
 * @module @idealize/ui-bar/notes
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** The notes folder's name inside the documentation vault. */
export const NOTES_FOLDER = 'Notes'
/** The notes folder's name in Documents while no vault is set. */
export const FALLBACK_NOTES_FOLDER = 'IDEalize Notes'
/** The pointer to the current note, kept in the notes folder. */
export const CURRENT_POINTER = '.current-note'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A fresh note's file name and heading for one moment, in local time.
 * @param now - the moment the note is started.
 * @returns the file stem (sortable, `Notes 2026-10-06 1430`) and the heading (`Notes, 6 Oct 2026`).
 */
export function noteName(now: Date): { stem: string; heading: string } {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const date = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return {
    stem: `Notes ${date} ${pad(now.getHours())}${pad(now.getMinutes())}`,
    heading: `Notes, ${String(now.getDate())} ${MONTHS[now.getMonth()] ?? ''} ${String(now.getFullYear())}`,
  }
}

/** Whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // Nothing at the path, or no way to see it: either way it is not a note to reopen.
    return false
  }
}

/**
 * The current note in `folder`, creating the folder, and a fresh note when
 * the pointer names nothing on disk or `fresh` asks for one.
 * @param folder - the notes folder (created when missing).
 * @param fresh - start a new note and make it current.
 * @param now - the clock, for the new note's name.
 * @returns the absolute path of the current note.
 */
export async function currentNote(folder: string, fresh: boolean, now: Date = new Date()): Promise<string> {
  await mkdir(folder, { recursive: true })
  const pointer = join(folder, CURRENT_POINTER)
  if (!fresh) {
    const named = await readFile(pointer, 'utf8').then(text => text.trim(), () => '')
    // The pointer holds a bare file name, so it can never reach outside the folder.
    if (named !== '' && named === basename(named) && await exists(join(folder, named))) return join(folder, named)
  }
  const { stem, heading } = noteName(now)
  let file = `${stem}.md`
  for (let n = 2; await exists(join(folder, file)); n += 1) file = `${stem} (${String(n)}).md`
  await writeFile(join(folder, file), `# ${heading}\n\n`, { encoding: 'utf8', flag: 'wx' })
  await writeFile(pointer, `${file}\n`, 'utf8')
  return join(folder, file)
}
