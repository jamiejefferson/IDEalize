/** The messenger reads the token and paired chat on every call and sends nothing without both. */

import { describe, expect, it, vi } from 'vitest'
import type { BotApi } from '../src/api.ts'
import { createMessenger } from '../src/messenger.ts'

function bench(chatId: string, withBot = true) {
  const bot = {
    sendMessage: vi.fn(async () => 5),
    editMessageText: vi.fn(async () => {}),
    answerCallbackQuery: vi.fn(async () => {}),
    sendChatAction: vi.fn(async () => {}),
  }
  const messenger = createMessenger({
    bot: async () => (withBot ? bot as unknown as BotApi : undefined),
    chatId: () => chatId,
  })
  return { bot, messenger }
}

describe('createMessenger', () => {
  it('shows typing in the paired chat, and nowhere when unpaired or without a bot', async () => {
    const paired = bench('42')
    await paired.messenger.typing()
    expect(paired.bot.sendChatAction).toHaveBeenCalledWith('42')
    const unpaired = bench('')
    await unpaired.messenger.typing()
    expect(unpaired.bot.sendChatAction).not.toHaveBeenCalled()
    await bench('42', false).messenger.typing()
  })

  it('sends, edits and answers in the paired chat', async () => {
    const { bot, messenger } = bench('42')
    await expect(messenger.send('hi', [[{ text: 'A', data: 'a' }]])).resolves.toBe(5)
    await messenger.edit(5, 'bye')
    await messenger.answer('q', 'ok')
    expect(bot.sendMessage).toHaveBeenCalledWith('42', 'hi', [[{ text: 'A', data: 'a' }]])
    expect(bot.editMessageText).toHaveBeenCalledWith('42', 5, 'bye', undefined)
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('q', 'ok')
  })

  it('sends a pairing reply to another chat even when unpaired', async () => {
    const { bot, messenger } = bench('')
    await messenger.send('Paired.', undefined, '99')
    expect(bot.sendMessage).toHaveBeenCalledWith('99', 'Paired.', undefined)
  })

  it('sends and edits nothing while unpaired', async () => {
    const { bot, messenger } = bench('')
    await expect(messenger.send('hi')).resolves.toBeUndefined()
    await messenger.edit(1, 'x')
    expect(bot.sendMessage).not.toHaveBeenCalled()
    expect(bot.editMessageText).not.toHaveBeenCalled()
  })

  it('does nothing without a token', async () => {
    const { messenger } = bench('42', false)
    await expect(messenger.send('hi')).resolves.toBeUndefined()
    await expect(messenger.edit(1, 'x')).resolves.toBeUndefined()
    await expect(messenger.answer('q')).resolves.toBeUndefined()
  })
})
