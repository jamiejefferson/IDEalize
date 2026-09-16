/**
 * The {@link Messenger} bound to the current token and paired chat, both
 * resolved on every call so a changed token or an unpair takes effect on the
 * next message.
 * @module @idealize/telegram/messenger
 */

import type { BotApi } from './api.ts'
import type { Keyboard, Messenger } from './ports.ts'

/** Where the messenger reads its token and chat. */
export interface MessengerSource {
  /** A client for the current token; undefined when none is stored. */
  bot(): Promise<BotApi | undefined>
  /** The paired chat id; empty when unpaired. */
  chatId(): string
}

/**
 * Bind a messenger to its source.
 * @param source - the token and chat lookups.
 * @returns the messenger.
 */
export function createMessenger(source: MessengerSource): Messenger {
  return {
    async send(text: string, keyboard?: Keyboard, chatId?: string): Promise<number | undefined> {
      const chat = chatId ?? source.chatId()
      if (chat === '') return undefined
      const bot = await source.bot()
      return await bot?.sendMessage(chat, text, keyboard)
    },
    async edit(messageId: number, text: string, keyboard?: Keyboard): Promise<void> {
      const chat = source.chatId()
      if (chat === '') return
      await (await source.bot())?.editMessageText(chat, messageId, text, keyboard)
    },
    async typing(): Promise<void> {
      const chat = source.chatId()
      if (chat === '') return
      await (await source.bot())?.sendChatAction(chat)
    },
    async answer(queryId: string, text?: string): Promise<void> {
      await (await source.bot())?.answerCallbackQuery(queryId, text)
    },
  }
}
