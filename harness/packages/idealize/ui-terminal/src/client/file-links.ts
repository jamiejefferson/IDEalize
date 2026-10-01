/**
 * Markdown paths in a terminal chat's output become links that open in the
 * app's file viewer (JJ, 30 Sep 2026: "md file links in the chat should open
 * in the file viewer inside idealize"). An agent in the terminal prints the
 * files it writes (`Write(docs/plan.md)`, `Wrote 40 lines to notes.md`); a
 * click on one shows it beside the chat instead of leaving the app.
 *
 * Only paths the viewer says it shows are linked, and a relative one resolves
 * against the chat's folder, which is where the agent runs. A row that wraps
 * is read as one line with its neighbours, so a long path broken across rows
 * still links whole. A click that ends a drag-selection opens nothing.
 */
import type { IBuffer, IBufferRange, ILink, ILinkProvider } from '@xterm/xterm'

/** The viewer a terminal link opens into (structurally the chat's file viewer). */
export interface TerminalFileViewer {
  /** Whether the viewer shows this file. */
  shows(path: string): boolean
  /** Show the file. */
  open(path: string): void
}

/** The grid face the provider reads (a slice of xterm's `Terminal`). */
export interface LinkGrid {
  readonly buffer: { readonly active: IBuffer }
  readonly cols: number
  hasSelection(): boolean
}

/**
 * A path token: optional `~`, `.` or `..` anchor, folders, and a file ending
 * in `.md` or `.markdown`. The lookbehind keeps it from starting mid-word; the
 * lookahead stops `notes.md.bak` and `notes.mdx` matching while letting a
 * sentence's full stop, a closing bracket or a `:line` suffix follow.
 */
const MARKDOWN_PATH = /(?<![\w@%+\-./~])(?:~|\.{1,2})?\/?(?:[\w@%+\-.]+\/)*[\w@%+\-.]+\.(?:md|markdown)(?![\w/-]|\.\w)/gi

/** One logical line: its text and, per UTF-16 unit, the 0-based cell it came from. */
interface LogicalLine {
  text: string
  cells: { x: number; y: number }[]
}

/**
 * Read the logical line holding buffer row `y`: back to the row that does not
 * continue a wrap, forward while the next row does.
 * @param buffer - the active buffer.
 * @param y - 0-based buffer row.
 * @param cols - the grid's width in cells.
 * @returns the line's text with a cell for each of its code units.
 */
function logicalLine(buffer: IBuffer, y: number, cols: number): LogicalLine {
  let first = y
  while (first > 0 && buffer.getLine(first)?.isWrapped === true) first -= 1
  let last = y
  while (buffer.getLine(last + 1)?.isWrapped === true) last += 1
  const line: LogicalLine = { text: '', cells: [] }
  for (let row = first; row <= last; row += 1) {
    const bufferLine = buffer.getLine(row)
    if (bufferLine === undefined) break
    for (let x = 0; x < Math.min(cols, bufferLine.length); x += 1) {
      const cell = bufferLine.getCell(x)
      // The second half of a wide glyph has width 0 and no text of its own.
      if (cell === undefined || cell.getWidth() === 0) continue
      const chars = cell.getChars() === '' ? ' ' : cell.getChars()
      line.text += chars
      for (let unit = 0; unit < chars.length; unit += 1) line.cells.push({ x, y: row })
    }
  }
  return line
}

/**
 * A printed path, made openable: absolute and `~/` paths as printed, others
 * under the chat's folder.
 * @param printed - the path as the output spells it.
 * @param cwd - the chat's folder, when known.
 * @returns the path to open, or undefined for a relative path with no folder.
 */
export function terminalFilePath(printed: string, cwd: string | undefined): string | undefined {
  if (printed.startsWith('/') || printed.startsWith('~/')) return printed
  if (cwd === undefined || cwd === '') return undefined
  return `${cwd.replace(/\/+$/, '')}/${printed.replace(/^\.\//, '')}`
}

/**
 * The link provider over one grid.
 * @param grid - the terminal whose output is read.
 * @param cwd - reads the chat's folder at the time of the hover.
 * @param viewer - reads the viewer at the time of the hover; undefined links nothing.
 * @returns the provider to hand `terminal.registerLinkProvider`.
 */
export function markdownPathLinks(
  grid: LinkGrid,
  cwd: () => string | undefined,
  viewer: () => TerminalFileViewer | undefined,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const opener = viewer()
      if (opener === undefined) {
        callback(undefined)
        return
      }
      const row = bufferLineNumber - 1
      const line = logicalLine(grid.buffer.active, row, grid.cols)
      const links: ILink[] = []
      for (const match of line.text.matchAll(MARKDOWN_PATH)) {
        const path = terminalFilePath(match[0], cwd())
        if (path === undefined || !opener.shows(path)) continue
        const from = line.cells[match.index]
        const to = line.cells[match.index + match[0].length - 1]
        // Every unit of the text came from a cell, so both ends are present.
        if (from === undefined || to === undefined) continue
        // xterm asks row by row: hand back only the links that touch this one.
        if (from.y > row || to.y < row) continue
        const range: IBufferRange = { start: { x: from.x + 1, y: from.y + 1 }, end: { x: to.x + 1, y: to.y + 1 } }
        links.push({
          range,
          text: match[0],
          activate: () => {
            if (grid.hasSelection()) return
            opener.open(path)
          },
        })
      }
      callback(links.length === 0 ? undefined : links)
    },
  }
}
