/**
 * The no-answer check that sits alongside the five-minute idle timeout. With no
 * network, a request can hang with nothing to tell it so, and the chat waited
 * the whole five minutes to say anything.
 *
 * A plain 30-second cut-off would stop models that are working. pi-ai's first
 * event fires when the HTTP response starts, and a server can hold that back:
 * Ollama waits until a model has loaded, and some gateways wait for the first
 * token, which long thinking delays by minutes. Keep-alive lines in the stream
 * do not produce events at all. So silence alone proves nothing.
 *
 * What the check does instead: after 30 seconds with no response, and every 30
 * seconds after that, it asks whether the provider's server answers at all. A
 * server that answers keeps its request for as long as the idle timeout allows.
 * Only a server that cannot be reached ends the request. A model on this
 * computer is never checked, because there is no network between it and the app.
 */

import { isLoopbackAddress } from './address.ts'

/** How long a request waits for its first byte before the server is checked, and how often after that. */
export const DEFAULT_FIRST_BYTE_CHECK_MS = 30_000

/** The timeout reason's code when the server could not be reached. */
export const FIRST_BYTE_CODE = 'LLM_FIRST_BYTE_UNREACHABLE'

/** One request's check. */
export interface FirstByteWatch extends Disposable {
  /**
   * Pass the provider's event stream through this: its first event, of any kind, ends the check.
   * @param events - the provider's event stream.
   * @returns the same events.
   */
  noticing<T>(events: AsyncIterable<T>): AsyncIterable<T>
}

/**
 * Start the check for one request.
 * @param options.baseUrl - the provider's address; empty when the provider decides it itself, which leaves nothing to check.
 * @param options.everyMs - the wait before each check.
 * @param options.reachable - asks whether the server answers.
 * @param options.onUnreachable - called once, when it does not.
 * @returns the running check.
 */
export function watchForFirstByte(options: {
  baseUrl: string
  everyMs: number
  reachable: (baseUrl: string) => Promise<boolean>
  onUnreachable: () => void
}): FirstByteWatch {
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = false
  const finish = (): void => {
    done = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const schedule = (): void => {
    timer = setTimeout(() => {
      void options.reachable(options.baseUrl).then((up) => {
        if (done) return
        if (up) {
          schedule()
          return
        }
        finish()
        options.onUnreachable()
      })
    }, options.everyMs)
    timer.unref()
  }
  if (options.baseUrl !== '' && !isLoopbackAddress(options.baseUrl)) schedule()
  return {
    async * noticing<T>(events: AsyncIterable<T>): AsyncIterable<T> {
      for await (const event of events) {
        finish()
        yield event
      }
    },
    [Symbol.dispose]: finish,
  }
}
