/**
 * Reads typed lines back out of a terminal's keystrokes, so a terminal chat
 * can be named from the first prompt typed into it (JJ, 7 Oct 2026). The
 * keystrokes are xterm's `onData` stream: printable text, Backspace (DEL or
 * BS), Ctrl-U, escape sequences (arrows, bracketed-paste markers) and Enter
 * (CR). Cursor movement inside the line is not followed, so an edited line
 * reads as typed in order; good enough for a name, never shown as the prompt.
 */

/** Escape sequences: CSI (ESC [ … final), SS3 (ESC O x), and two-byte ESC x. */
const ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|O.|.)/gsu

/** Keystroke-to-line reader for one terminal. */
export class PromptLines {
  private line = ''

  /** The line typed so far and not yet sent with Enter; empty when there is none. */
  get draft(): string {
    return this.line
  }

  /**
   * Feed one `onData` chunk.
   * @param data - the keystrokes.
   * @returns each line completed by Enter in this chunk, trimmed, in order.
   */
  push(data: string): string[] {
    const done: string[] = []
    for (const character of data.replace(ESCAPE, '')) {
      if (character === '\r' || character === '\n') {
        const finished = this.line.trim()
        if (finished !== '') done.push(finished)
        this.line = ''
      } else if (character === '\u007F' || character === '\b') {
        this.line = Array.from(this.line).slice(0, -1).join('')
      } else if (character === '\u0015') {
        this.line = ''
      } else if (character >= ' ') {
        this.line += character
      }
    }
    return done
  }
}

/**
 * Whether a typed line reads like a prompt worth naming a chat after: three
 * words or more, so `ls`, `y` and a slash command pass by.
 * @param line - one typed line.
 * @returns whether to name the chat from it.
 */
export function namesAChat(line: string): boolean {
  return !line.startsWith('/') && line.split(/\s+/u).filter(Boolean).length >= 3
}
