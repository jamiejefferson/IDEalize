/**
 * The narrow views of other plugins' services this plugin calls, so the
 * routers are testable without composing the Studio, comm or the agent
 * registry. The host plugin binds each to the live service through
 * `ctx.get`, because every one of them is optional in a composition.
 * @module @idealize/telegram/ports
 */

import type { SessionRecord } from '@idealize/comm'
import type { StudioChatPost, StudioOverviewProject, StudioState } from '@idealize/studio'
import type { InlineButton } from './api.ts'

/** Inline-keyboard rows. */
export type Keyboard = readonly (readonly InlineButton[])[]

/** Sends to the paired chat with the current token. Every call is a no-op answer when no token or chat is set. */
export interface Messenger {
  /**
   * Send a message.
   * @param text - the message.
   * @param keyboard - buttons under it.
   * @param chatId - a chat other than the paired one (pairing replies).
   * @returns the sent message's id, or undefined when nothing was sent.
   */
  send(text: string, keyboard?: Keyboard, chatId?: string): Promise<number | undefined>
  /**
   * Replace a sent message's text and buttons in the paired chat.
   * @param messageId - the message.
   * @param text - the new text.
   * @param keyboard - the new buttons; none removes them.
   */
  edit(messageId: number, text: string, keyboard?: Keyboard): Promise<void>
  /** Show "typing…" in the paired chat for the next few seconds; nothing when unpaired. */
  typing(): Promise<void>
  /**
   * Acknowledge a button press.
   * @param queryId - the callback query.
   * @param text - a short toast.
   */
  answer(queryId: string, text?: string): Promise<void>
}

/** One roster row: comm's session record with whether its agent is live. */
export type RosterRow = SessionRecord & { running: boolean }

/** The Studio calls this plugin makes. */
export interface StudioPort {
  postFromChat(text: string, messageId: string): Promise<StudioChatPost>
  overview(): Promise<StudioOverviewProject[]>
  state(project: string): Promise<StudioState>
}

/** The comm calls this plugin makes. */
export interface CommPort {
  roster(): Promise<RosterRow[]>
}

/** One live agent, as far as stopping it goes. */
export interface AgentPort {
  readonly status: 'idle' | 'running'
  cancel(cause: { kind: 'user' }, options: { keepInbox: boolean }): void
}

/** The agent registry, as far as finding one agent goes. */
export interface AgentsPort {
  get(id: string): AgentPort | undefined
}

/** Live lookups of the optional services; each is undefined when the composition lacks it. */
export interface Services {
  studio(): StudioPort | undefined
  comm(): CommPort | undefined
  agents(): AgentsPort | undefined
}

/**
 * The name a person knows a session by.
 * @param roster - the roster.
 * @param id - the session id.
 * @returns the agent name, else the task label, else the id.
 */
export function nameOf(roster: readonly RosterRow[], id: string): string {
  const row = roster.find(entry => entry.id === id)
  return row?.name ?? row?.label ?? id
}
