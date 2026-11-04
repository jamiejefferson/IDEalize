/**
 * Routes each Telegram update. `/pair <code>` from a private chat is the only
 * thing a stranger can do; every other message and button press is ignored
 * unless it comes from the paired person in the paired chat. From them, a message older than the
 * stale limit is refused (it was sent while the app was closed), a question
 * waiting for typed input takes the text, a command runs, and anything else
 * is posted to the Studio exactly as if typed in the Studio chat.
 * @module @idealize/telegram/inbound
 */

import { resolveTarget } from '@idealize/comm'
import type { TelegramCallbackQuery, TelegramMessage, TelegramUpdate, TelegramUser } from './api.ts'
import { agentsText, chatPostReply, HELP_TEXT, INBOUND_TEXT, PAIR_REPLIES, statusText } from './format.ts'
import type { PairingClaim, PairingClaimant } from './pairing.ts'
import { nameOf, type Messenger, type Services } from './ports.ts'
import type { Relay } from './relay.ts'
import type { Typing } from './typing.ts'

/** What the router needs from its owner. */
export interface InboundOptions {
  messenger: Messenger
  services: Services
  relay: Pick<Relay, 'press' | 'takeText' | 'pendingCount'>
  /** The phone's "typing…", started once a note reaches the Studio coordinator. */
  typing: Pick<Typing, 'start'>
  /** The paired chat id; empty when unpaired. */
  pairedChat(): string
  /** The paired user id; empty when unpaired. */
  pairedUser(): string
  /** Try a pairing code; a match waits for the person to allow the claimant in the app window. */
  claimPairing(claimant: PairingClaimant, code: string): Promise<PairingClaim>
  /** Messages older than this, in milliseconds, are refused. */
  staleAfterMs: number
  /** The clock (tests pin it). */
  now?(): number
}

const PAIR = /^\/pair(?:@\w+)?\s+(\S+)$/
const COMMAND = /^\/(\w+)(?:@\w+)?(?:\s+([\s\S]*))?$/

/** A person's name as Telegram gives it, for the app window to show. */
function nameFrom(user: TelegramUser): string {
  return user.username === undefined || user.username === '' ? user.first_name ?? String(user.id) : `@${user.username}`
}

/** The update router. */
export class Inbound {
  constructor(private readonly options: InboundOptions) {}

  /**
   * Route one update.
   * @param update - the update from `getUpdates`.
   */
  async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query !== undefined) {
      await this.onPress(update.callback_query)
      return
    }
    if (update.message?.text !== undefined) await this.onMessage(update.message, update.message.text.trim())
  }

  /** Whether a message or press comes from the paired person in the paired chat. */
  private isPaired(chatId: string, from: TelegramUser | undefined): boolean {
    const paired = this.options.pairedChat()
    const user = this.options.pairedUser()
    return paired !== '' && user !== '' && chatId === paired && from !== undefined && String(from.id) === user
  }

  private async onMessage(message: TelegramMessage, text: string): Promise<void> {
    const { messenger, relay } = this.options
    const chatId = String(message.chat.id)
    const pair = PAIR.exec(text)
    if (pair !== null) {
      // A code sent in a group could pair the whole group: anyone in it could then direct the app.
      const claim = message.chat.type !== 'private' || message.from === undefined
        ? 'not-private'
        : await this.options.claimPairing({ chatId, userId: String(message.from.id), name: nameFrom(message.from) }, pair[1] as string)
      await messenger.send(PAIR_REPLIES[claim], undefined, chatId)
      return
    }
    if (!this.isPaired(chatId, message.from)) return
    const now = this.options.now?.() ?? Date.now()
    if (now - message.date * 1000 > this.options.staleAfterMs) {
      await messenger.send(INBOUND_TEXT.stale)
      return
    }
    if (await relay.takeText(text)) return
    const command = COMMAND.exec(text)
    if (command === null) {
      await this.post(text, `telegram-${chatId}-${message.message_id}`)
      return
    }
    const argument = (command[2] ?? '').trim()
    switch (command[1]) {
      case 'status':
        await this.status()
        return
      case 'agents':
        await messenger.send(agentsText(await this.roster()))
        return
      case 'stop':
        await this.askToStop(argument)
        return
      default:
        await messenger.send(HELP_TEXT)
    }
  }

  private async onPress(query: TelegramCallbackQuery): Promise<void> {
    const { messenger } = this.options
    if (query.message === undefined || !this.isPaired(String(query.message.chat.id), query.from)) {
      await messenger.answer(query.id)
      return
    }
    const data = query.data ?? ''
    if (await this.options.relay.press(query.id, data)) return
    if (data.startsWith('s:')) {
      await this.stop(query.id, query.message.message_id, data.slice(2))
      return
    }
    if (data === 'k') {
      await messenger.answer(query.id)
      await messenger.edit(query.message.message_id, INBOUND_TEXT.keptRunning)
      return
    }
    await messenger.answer(query.id)
  }

  private async roster() {
    return await this.options.services.comm()?.roster() ?? []
  }

  private async post(text: string, messageId: string): Promise<void> {
    const studio = this.options.services.studio()
    if (studio === undefined) {
      await this.options.messenger.send(INBOUND_TEXT.noStudio)
      return
    }
    const post = await studio.postFromChat(text, messageId)
    if (post.kind === 'delivered') this.options.typing.start()
    const reply = chatPostReply(post, await this.roster())
    if (reply !== undefined) await this.options.messenger.send(reply)
  }

  private async status(): Promise<void> {
    const overview = await this.options.services.studio()?.overview() ?? []
    await this.options.messenger.send(statusText(overview, await this.roster(), this.options.relay.pendingCount()))
  }

  private async askToStop(target: string): Promise<void> {
    const { messenger, services } = this.options
    if (target === '') {
      await messenger.send(INBOUND_TEXT.stopWho)
      return
    }
    const roster = await this.roster()
    const resolution = resolveTarget(target, roster)
    if (!resolution.ok) {
      await messenger.send(resolution.error)
      return
    }
    const name = nameOf(roster, resolution.session.id)
    if (services.agents()?.get(resolution.session.id)?.status !== 'running') {
      await messenger.send(INBOUND_TEXT.notRunning(name))
      return
    }
    await messenger.send(INBOUND_TEXT.confirmStop(name), [[
      { text: INBOUND_TEXT.stopButton, data: `s:${resolution.session.id}` },
      { text: INBOUND_TEXT.keepButton, data: 'k' },
    ]])
  }

  private async stop(queryId: string, messageId: number, sessionId: string): Promise<void> {
    const { messenger, services } = this.options
    const name = nameOf(await this.roster(), sessionId)
    const agent = services.agents()?.get(sessionId)
    await messenger.answer(queryId)
    if (agent?.status !== 'running') {
      await messenger.edit(messageId, INBOUND_TEXT.notRunning(name))
      return
    }
    agent.cancel({ kind: 'user' }, { keepInbox: true })
    await messenger.edit(messageId, INBOUND_TEXT.stopped(name))
  }
}
