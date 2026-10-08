/**
 * Reading a project switch out of a message. Pure, so the owl window and the
 * host share it: the host switches before the model runs, and the window
 * skips the acknowledgement because the answer is instant.
 * @module @idealize/powell/switch
 */

/** A request that only names the project to work on, and what is left after it. */
export interface ProjectSwitch {
  /** The project as the person said it. */
  said: string
  /** The rest of the message, empty when the message was only the switch. */
  rest: string
}

const SWITCH = new RegExp(
  String.raw`^\s*(?:(?:ok(?:ay)?|right|so)[,.]?\s+)?`
  + String.raw`(?:we(?:'re| are)\s+(?:working\s+)?on|i(?:'m| am)\s+working\s+on|let's\s+work\s+on|switch(?:\s+over)?\s+to`
  + String.raw`|(?:change|set)\s+(?:the\s+)?project\s+to)\s+`
  + String.raw`(?:the\s+)?(.+?)(?:\s+project)?(?:\s+(?:today|now|for now|this morning|this afternoon))?\s*(?:[.!]+\s*(.*))?$`,
  'is')

/**
 * Read a project switch out of a message ("We're working on JACQ today.",
 * "Switch to Hatch. Open the brief."), so the switch happens before the model
 * runs and never depends on it remembering to call a tool.
 * @param text - the person's message.
 * @returns the switch, or undefined when the message does not open with one.
 */
export function readProjectSwitch(text: string): ProjectSwitch | undefined {
  const match = SWITCH.exec(text.trim())
  if (match === null) return undefined
  const said = (match[1] ?? '').trim().replace(/[.!?,]+$/, '')
  if (said === '' || said.split(/\s+/).length > 4) return undefined
  return { said, rest: (match[2] ?? '').trim() }
}
