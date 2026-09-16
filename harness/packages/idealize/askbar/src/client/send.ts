/**
 * The one way the bar reaches an agent: comm's `send` command, the same path
 * the panel's ask field posts through. Voice and typing share it so a
 * transcript is delivered exactly as a typed message is.
 * @module @idealize/askbar/src/client/send
 */

/**
 * Send one message to a named agent.
 * @param target - the agent's chat id.
 * @param body - what to say.
 * @returns whether comm accepted it.
 */
export async function sendToAgent(target: string, body: string): Promise<boolean> {
  try {
    const response = await fetch('/idealize/comm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ command: 'send', from: 'user', target, body }),
    })
    return (await response.json() as { ok: boolean }).ok
  } catch {
    // An unreachable host is already on screen from the roster poll.
    return false
  }
}
