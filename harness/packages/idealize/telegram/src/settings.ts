/** The `idealize-telegram` settings section shared by the Host schema and the browser scope. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by this plugin. */
export const TELEGRAM_SETTINGS_NAMESPACE = 'idealize-telegram'

/** Durable preferences: who the bot answers and what it sends them. */
export interface TelegramSettings {
  /** The paired Telegram chat id, as decimal text; empty until a chat pairs. The bot obeys this chat alone. */
  chatId: string
  /** Send the Studio coordinator's posts to the paired chat. */
  forwardStudioReplies: boolean
  /** Send one line when a task on any timeline ends. */
  forwardTaskEndings: boolean
  /** Send the Studio's attention alerts and agent errors. */
  forwardAttention: boolean
  /** Send approval requests and questions with answer buttons. */
  forwardApprovals: boolean
}

/** Durable schema; also the wire envelope the browser scope validates against. */
export const TelegramSettingsSchema: z<TelegramSettings> = z.object({
  chatId: z.string().default(''),
  forwardStudioReplies: z.boolean().default(true),
  forwardTaskEndings: z.boolean().default(true),
  forwardAttention: z.boolean().default(true),
  forwardApprovals: z.boolean().default(true),
})

/** The section's schema defaults: unpaired, every forward on. */
export const TELEGRAM_DEFAULTS: TelegramSettings = TelegramSettingsSchema({} as TelegramSettings)

/** The forward toggles a settings row flips, in display order. */
export const FORWARD_KEYS = ['forwardStudioReplies', 'forwardTaskEndings', 'forwardAttention', 'forwardApprovals'] as const

/** One of {@link FORWARD_KEYS}. */
export type ForwardKey = typeof FORWARD_KEYS[number]

/** What `GET /idealize/telegram/status` answers. */
export interface TelegramStatus {
  /** Whether a bot token resolves. */
  configured: boolean
  /** Whether the environment sets the token, so the app cannot change it. */
  shadowed: boolean
  /** The bot's @username once `getMe` has answered; empty before. */
  botUsername: string
  /** Whether a chat is paired. */
  paired: boolean
  /** The pairing code waiting to be sent, and when it stops working (epoch ms). */
  pairing?: { code: string; expiresAt: number } | undefined
  /** The most recent problem in plain words; empty when the bot is working. */
  problem: string
}
