/**
 * What the adapter may send to an address, and whether an address can still be
 * reached. Both read the same fact about a URL: whether it is on this computer.
 */

import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * Whether an address is on this computer. LM Studio and Ollama serve plain http
 * here, and the traffic never leaves the machine. 0.0.0.0 is how some of them
 * print their own address; connecting to it reaches this computer.
 * @param baseUrl - a URL.
 * @returns true for loopback addresses, false for everything else, including a URL that cannot be parsed.
 */
export function isLoopbackAddress(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    return host === 'localhost' || host === '[::1]' || host === '0.0.0.0' || /^127\.\d+\.\d+\.\d+$/u.test(host)
  } catch {
    return false
  }
}

/**
 * Whether sending a key to this address could expose it on the network.
 * @param baseUrl - the provider's address; empty when the provider decides it itself.
 * @returns true for an unencrypted address off this computer.
 */
export function exposesKey(baseUrl: string): boolean {
  if (baseUrl === '') return false
  let protocol: string
  try {
    protocol = new URL(baseUrl).protocol
  } catch {
    // Nothing can be sent to an address that does not parse.
    return false
  }
  return (protocol === 'http:' || protocol === 'ws:') && !isLoopbackAddress(baseUrl)
}

/**
 * Refuse to send a stored key over an unencrypted connection. Anyone on the
 * network path can read it there, and a settings file edited by something else
 * could point a stored key at any server.
 * @param provider - the route, named in the message.
 * @param baseUrl - the address the key would go to.
 * @throws LlmError when the address would expose the key.
 */
export function assertKeyMayGoTo(provider: string, baseUrl: string): void {
  if (!exposesKey(baseUrl)) return
  throw new LlmError(
    `Your key for ${provider} was not sent, because ${baseUrl} is not a secure address. `
    + 'Use an address that starts with https, or a local address for a model on this computer.',
    'INSECURE_ADDRESS',
  )
}

/**
 * Whether the provider's server can be reached at all. Any answer counts, a 404
 * included, and it goes through the same network stack as the model request, so
 * it follows the same proxy.
 * @param baseUrl - the provider's address.
 * @param timeoutMs - how long to wait for an answer.
 * @returns false only when nothing answered.
 */
export async function isReachable(baseUrl: string, timeoutMs = 10_000): Promise<boolean> {
  try {
    await fetch(new URL(baseUrl).origin, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}
