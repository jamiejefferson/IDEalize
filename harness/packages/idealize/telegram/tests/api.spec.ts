/**
 * The Bot API client: the request each method sends, how long text is split,
 * and how each kind of failure is reported without quoting the token.
 */

import { describe, expect, it, vi } from 'vitest'
import { BotApi, MESSAGE_LIMIT, splitText, TelegramApiError } from '../src/api.ts'

interface Call {
  url: string
  body: Record<string, unknown>
}

type Reply = Response | Error | (() => never)

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function fake(replies: Reply[] = []) {
  const calls: Call[] = []
  let sent = 0
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    calls.push({ url: href, body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown> })
    const next = replies.shift()
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next()
    sent += 1
    return next ?? json({ ok: true, result: { message_id: sent, date: 0, chat: { id: 1, type: 'private' } } })
  })
  const api = new BotApi({ token: '123:secret', apiBase: 'https://tg.test', fetchImpl: impl, requestTimeoutMs: 1000 })
  return { api, calls }
}

describe('splitText', () => {
  it('keeps text within the limit whole, including empty text', () => {
    expect(splitText('hello')).toEqual(['hello'])
    expect(splitText('')).toEqual([''])
  })

  it('breaks at the last newline inside the limit and drops that newline', () => {
    expect(splitText('aaaa\nbbbbbbbbbbbb', 10)).toEqual(['aaaa', 'bbbbbbbbbb', 'bb'])
  })

  it('cuts hard when no newline sits after the first character', () => {
    expect(splitText(`\n${'x'.repeat(12)}`, 10)).toEqual([`\n${'x'.repeat(9)}`, 'xxx'])
  })
})

describe('BotApi', () => {
  it('posts JSON to the method URL and returns the result', async () => {
    const { api, calls } = fake([json({ ok: true, result: { id: 7, username: 'idealize_bot' } })])
    await expect(api.getMe()).resolves.toEqual({ id: 7, username: 'idealize_bot' })
    expect(calls).toEqual([{ url: 'https://tg.test/bot123:secret/getMe', body: {} }])
  })

  it('reports an empty username when the bot has none', async () => {
    const { api } = fake([json({ ok: true, result: { id: 7 } })])
    await expect(api.getMe()).resolves.toEqual({ id: 7, username: '' })
  })

  it('asks for messages and button presses from the offset', async () => {
    const { api, calls } = fake([json({ ok: true, result: [{ update_id: 4 }] })])
    await expect(api.getUpdates(4, 30, new AbortController().signal)).resolves.toEqual([{ update_id: 4 }])
    expect(calls[0]?.body).toEqual({ offset: 4, timeout: 30, allowed_updates: ['message', 'callback_query'] })
  })

  it('splits a long message and puts the buttons on the last piece', async () => {
    const { api, calls } = fake()
    const id = await api.sendMessage('42', 'x'.repeat(MESSAGE_LIMIT + 5), [[{ text: 'Allow', data: 'a:1:y' }]])
    expect(id).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.body).toEqual({ chat_id: '42', text: 'x'.repeat(MESSAGE_LIMIT) })
    expect(calls[1]?.body).toEqual({
      chat_id: '42',
      text: 'xxxxx',
      reply_markup: { inline_keyboard: [[{ text: 'Allow', callback_data: 'a:1:y' }]] },
    })
  })

  it('shows a chat action, typing unless told otherwise', async () => {
    const { api, calls } = fake([json({ ok: true, result: true }), json({ ok: true, result: true })])
    await api.sendChatAction('42')
    await api.sendChatAction('42', 'upload_photo')
    expect(calls[0]?.body).toEqual({ chat_id: '42', action: 'typing' })
    expect(calls[1]?.body).toEqual({ chat_id: '42', action: 'upload_photo' })
  })

  it('sends a message with no buttons', async () => {
    const { api, calls } = fake()
    await api.sendMessage('42', 'hi')
    expect(calls[0]?.body).toEqual({ chat_id: '42', text: 'hi' })
  })

  it('edits text within the limit and removes the keyboard when given no buttons', async () => {
    const { api, calls } = fake([json({ ok: true, result: true }), json({ ok: true, result: true })])
    await api.editMessageText('42', 9, 'y'.repeat(MESSAGE_LIMIT + 1))
    await api.editMessageText('42', 9, 'z', [[{ text: 'Done', data: 'q:1:done' }]])
    expect(calls[0]?.body).toEqual({ chat_id: '42', message_id: 9, text: 'y'.repeat(MESSAGE_LIMIT), reply_markup: { inline_keyboard: [] } })
    expect(calls[1]?.body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'Done', callback_data: 'q:1:done' }]] })
  })

  it('acknowledges a button press with and without a toast', async () => {
    const { api, calls } = fake([json({ ok: true, result: true }), json({ ok: true, result: true })])
    await api.answerCallbackQuery('q1')
    await api.answerCallbackQuery('q2', 'Allowed')
    expect(calls.map(call => call.body)).toEqual([{ callback_query_id: 'q1' }, { callback_query_id: 'q2', text: 'Allowed' }])
  })

  it.each([
    [409, 'conflict'],
    [401, 'unauthorized'],
    [404, 'unauthorized'],
  ] as const)('maps HTTP %i to %s', async (code, kind) => {
    const { api } = fake([json({ ok: false, error_code: code, description: 'refused' }, code)])
    const error = await api.getMe().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(TelegramApiError)
    expect(error).toMatchObject({ kind, message: 'refused' })
  })

  it('carries the wait Telegram asks for on HTTP 429, defaulting to one second', async () => {
    const { api } = fake([
      json({ ok: false, error_code: 429, description: 'slow down', parameters: { retry_after: 7 } }, 429),
      json({ ok: false, error_code: 429 }, 429),
    ])
    await expect(api.getMe()).rejects.toMatchObject({ kind: 'rate-limited', retryAfterSeconds: 7 })
    await expect(api.getMe()).rejects.toMatchObject({ kind: 'rate-limited', retryAfterSeconds: 1, message: 'HTTP 429' })
  })

  it('reports another refusal with the method name', async () => {
    const { api } = fake([json({ ok: false, description: 'Bad Request: chat not found' }, 400)])
    await expect(api.sendMessage('1', 'x')).rejects.toMatchObject({ kind: 'failed', message: 'sendMessage: Bad Request: chat not found' })
  })

  it('reports a page that is not JSON by its status', async () => {
    const { api } = fake([new Response('<html>down</html>', { status: 502 })])
    await expect(api.getMe()).rejects.toMatchObject({ kind: 'failed', message: 'getMe: HTTP 502' })
  })

  it('reports a network failure without quoting the URL', async () => {
    const { api } = fake([new TypeError('fetch failed for https://tg.test/bot123:secret/getMe')])
    const error = await api.getMe().catch((caught: unknown) => caught) as TelegramApiError
    expect(error.kind).toBe('failed')
    expect(error.message).toBe('Telegram could not be reached (getMe): TypeError')
    expect(error.message).not.toContain('secret')
  })

  it('rethrows the abort when the caller cancelled', async () => {
    const controller = new AbortController()
    const reason = new Error('stopped')
    const { api } = fake([() => { controller.abort(); throw reason }])
    await expect(api.getUpdates(0, 1, controller.signal)).rejects.toBe(reason)
  })
})
