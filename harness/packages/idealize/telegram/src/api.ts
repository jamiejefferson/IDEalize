/**
 * A thin client for the Telegram Bot API methods this plugin calls. Every
 * call is one HTTPS POST of JSON to `<apiBase>/bot<token>/<method>`; the
 * token sits in the URL, so no error message this module raises quotes the
 * URL.
 * @module @idealize/telegram/api
 */

/** Telegram's cap on one message's text, in UTF-16 code units (protocol constant). */
export const MESSAGE_LIMIT = 4096

/** A chat as Telegram describes it. */
export interface TelegramChat {
  id: number
  type: string
}

/** One message, as far as this plugin reads it. */
export interface TelegramMessage {
  message_id: number
  /** Unix seconds the message was sent. */
  date: number
  chat: TelegramChat
  text?: string
}

/** A button press on an inline keyboard. */
export interface TelegramCallbackQuery {
  id: string
  /** The button's `callback_data`. */
  data?: string
  /** The message the keyboard belongs to; absent when Telegram no longer has it. */
  message?: TelegramMessage
}

/** One entry from `getUpdates`. */
export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

/** One inline-keyboard button. `data` is at most 64 bytes (protocol constant). */
export interface InlineButton {
  text: string
  data: string
}

/** What went wrong with a call, in the terms the poller acts on. */
export type TelegramErrorKind =
  /** Another client is polling the same bot (HTTP 409). */
  | 'conflict'
  /** The token is wrong or revoked (HTTP 401, or 404 for a malformed token). */
  | 'unauthorized'
  /** Telegram asked the client to wait (HTTP 429). */
  | 'rate-limited'
  /** Anything else: network failure, timeout, or another API refusal. */
  | 'failed'

/** A failed Bot API call. */
export class TelegramApiError extends Error {
  /**
   * @param kind - what the caller should do about it.
   * @param message - a plain description that never quotes the request URL.
   * @param retryAfterSeconds - the wait Telegram asked for, on `rate-limited`.
   */
  constructor(readonly kind: TelegramErrorKind, message: string, readonly retryAfterSeconds?: number) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

/** How a client reaches Telegram. */
export interface BotApiOptions {
  token: string
  /** The Bot API origin, without a trailing slash. */
  apiBase: string
  fetchImpl: typeof fetch
  /** Longest wait for an ordinary call, in milliseconds; a long poll adds its own hold on top. */
  requestTimeoutMs: number
}

interface ApiEnvelope {
  ok: boolean
  result?: unknown
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

/**
 * Split text into pieces Telegram accepts, breaking at the last newline
 * inside the limit when there is one.
 * @param text - the whole message.
 * @param limit - the longest piece.
 * @returns the pieces in order; one empty piece for empty text.
 */
export function splitText(text: string, limit: number = MESSAGE_LIMIT): string[] {
  const pieces: string[] = []
  let rest = text
  while (rest.length > limit) {
    const newline = rest.lastIndexOf('\n', limit)
    const cut = newline > 0 ? newline : limit
    pieces.push(rest.slice(0, cut))
    rest = rest.slice(newline > 0 ? cut + 1 : cut)
  }
  pieces.push(rest)
  return pieces
}

function keyboard(buttons: readonly (readonly InlineButton[])[]): unknown {
  return { inline_keyboard: buttons.map(row => row.map(button => ({ text: button.text, callback_data: button.data }))) }
}

/** One bot's Bot API calls. */
export class BotApi {
  constructor(private readonly options: BotApiOptions) {}

  /**
   * Call one Bot API method.
   * @param method - the method name.
   * @param params - the JSON body.
   * @param signal - cancels the call.
   * @param holdMs - extra time the call may legitimately take (a long poll's hold).
   * @returns the `result` field.
   */
  async call(method: string, params: object, signal?: AbortSignal, holdMs = 0): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.options.requestTimeoutMs + holdMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let response: Response
    try {
      response = await this.options.fetchImpl(`${this.options.apiBase}/bot${this.options.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: combined,
      })
    } catch (error) {
      if (signal?.aborted === true) throw error
      throw new TelegramApiError('failed', `Telegram could not be reached (${method}): ${(error as Error).name}`)
    }
    let envelope: ApiEnvelope
    try {
      envelope = await response.json() as ApiEnvelope
    } catch {
      // A proxy or outage page answered instead of the API; the status is all there is to report.
      envelope = { ok: false, error_code: response.status }
    }
    if (envelope.ok) return envelope.result
    const code = envelope.error_code ?? response.status
    const description = envelope.description ?? `HTTP ${code}`
    if (code === 409) throw new TelegramApiError('conflict', description)
    if (code === 401 || code === 404) throw new TelegramApiError('unauthorized', description)
    if (code === 429) throw new TelegramApiError('rate-limited', description, envelope.parameters?.retry_after ?? 1)
    throw new TelegramApiError('failed', `${method}: ${description}`)
  }

  /**
   * Check the token and learn the bot's name.
   * @param signal - cancels the call.
   * @returns the bot's id and @username.
   */
  async getMe(signal?: AbortSignal): Promise<{ id: number; username: string }> {
    const me = await this.call('getMe', {}, signal) as { id: number; username?: string }
    return { id: me.id, username: me.username ?? '' }
  }

  /**
   * Hold a long poll for new messages and button presses.
   * @param offset - one past the last update already handled.
   * @param holdSeconds - how long Telegram may hold the request open.
   * @param signal - cancels the poll.
   * @returns the updates, oldest first.
   */
  async getUpdates(offset: number, holdSeconds: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return await this.call('getUpdates', {
      offset,
      timeout: holdSeconds,
      allowed_updates: ['message', 'callback_query'],
    }, signal, holdSeconds * 1000) as TelegramUpdate[]
  }

  /**
   * Send text, split to Telegram's limit. Buttons ride on the last piece.
   * @param chatId - the chat.
   * @param text - the whole message.
   * @param buttons - inline keyboard rows.
   * @returns the id of the last message sent, which carries the buttons.
   */
  async sendMessage(chatId: string, text: string, buttons?: readonly (readonly InlineButton[])[]): Promise<number> {
    const pieces = splitText(text)
    let last = 0
    for (const [index, piece] of pieces.entries()) {
      const markup = buttons !== undefined && index === pieces.length - 1 ? { reply_markup: keyboard(buttons) } : {}
      const sent = await this.call('sendMessage', { chat_id: chatId, text: piece, ...markup }) as TelegramMessage
      last = sent.message_id
    }
    return last
  }

  /**
   * Replace a message's text and keyboard; no buttons removes the keyboard.
   * @param chatId - the chat.
   * @param messageId - the message.
   * @param text - the new text, cut to the limit.
   * @param buttons - the new keyboard rows.
   */
  async editMessageText(chatId: string, messageId: number, text: string, buttons?: readonly (readonly InlineButton[])[]): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: text.slice(0, MESSAGE_LIMIT),
      reply_markup: keyboard(buttons ?? []),
    })
  }

  /**
   * Show a chat action ("typing…") in a chat; Telegram clears it after about
   * five seconds or at the bot's next message, so a longer wait repeats it.
   * @param chatId - the chat.
   * @param action - the action; `typing` unless given.
   */
  async sendChatAction(chatId: string, action = 'typing'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action })
  }

  /**
   * Stop a pressed button's spinner, optionally with a short toast.
   * @param queryId - the callback query.
   * @param text - the toast.
   */
  async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: queryId, ...text === undefined ? {} : { text } })
  }
}
