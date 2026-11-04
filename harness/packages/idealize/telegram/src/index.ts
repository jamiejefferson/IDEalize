/**
 * @idealize/telegram — direct the Studio from a phone. A Telegram bot the
 * person creates is polled from inside the running app (no server, no public
 * URL), so the bot answers only while IDEalize is open.
 *
 * - Inbound: text from the paired chat is posted to the Studio as if typed in
 *   the Studio chat; `/status`, `/agents` and `/stop` read and stop agents;
 *   buttons answer approvals and questions.
 * - Outbound: coordinator posts, task endings, attention alerts, agent errors,
 *   and every pending approval and question, each behind a settings toggle.
 *
 * The bot token is a credential (`IDEALIZE_TELEGRAM_BOT_TOKEN`), resolved on
 * every poll. The paired chat id and the toggles live in the
 * `idealize-telegram` settings section. The routes are in `./routes.ts`.
 *
 * This plugin declares no required injection: every service it calls is
 * optional, read through `ctx.get` when used, and a composition without one
 * loses that feature only.
 * @module @idealize/telegram
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { BridgeEvent } from '@idealize/host-bridge'
import z from '@deepseek-ai/schemastery'
import { BotApi, TelegramApiError } from './api.ts'
import { Inbound } from './inbound.ts'
import { createMessenger } from './messenger.ts'
import { Typing } from './typing.ts'
import { Outbound } from './outbound.ts'
import { PAIR_REPLIES } from './format.ts'
import { Pairing, pairedIdentity, type PairingClaimant } from './pairing.ts'
import { Poller, type PollerProblem } from './poller.ts'
import { nameOf, type Services } from './ports.ts'
import { Relay } from './relay.ts'
import { installTelegramRoutes, type RouteOutcome } from './routes.ts'
import { TELEGRAM_DEFAULTS, TELEGRAM_SETTINGS_NAMESPACE, TelegramSettingsSchema, type TelegramSettings, type TelegramStatus } from './settings.ts'

export { BotApi, MESSAGE_LIMIT, splitText, TelegramApiError } from './api.ts'
export type { InlineButton, TelegramErrorKind, TelegramUpdate } from './api.ts'
export { CONFIRM_PATH, PAIR_PATH, STATUS_PATH, TOKEN_PATH } from './routes.ts'
export { FORWARD_KEYS, TELEGRAM_SETTINGS_NAMESPACE, TelegramSettingsSchema } from './settings.ts'
export type { ForwardKey, TelegramSettings, TelegramStatus } from './settings.ts'

export const name = 'idealize-telegram'

/** The credential the bot token is stored under. */
export const TOKEN_ENV = 'IDEALIZE_TELEGRAM_BOT_TOKEN'

/** Telegram's bot token format: the bot id, a colon, the secret (external spec). */
const TOKEN_SHAPE = /^\d+:[A-Za-z0-9_-]+$/

/** Validated configuration: where Telegram is and how patiently to talk to it. */
export interface Config {
  /** The Bot API origin, without a trailing slash. */
  apiBase: string
  /** How long Telegram may hold each poll open, in seconds. */
  holdSeconds: number
  /** Longest wait for an ordinary Bot API call, in milliseconds. */
  requestTimeoutMs: number
  /** Waits between consecutive polling failures, in milliseconds; the last repeats. */
  retryDelaysMs: number[]
  /** Messages older than this are refused as sent while the app was closed, in minutes. */
  staleAfterMinutes: number
  /** How long a pairing code stays claimable, in minutes. */
  pairCodeTtlMinutes: number
  /** Wrong pairing codes accepted before the live code is withdrawn. */
  maxWrongPairCodes: number
  /** Wait before reopening the approvals stream after it ends, in milliseconds. */
  muxReopenDelayMs: number
}

export const Config: z<Config> = z.object({
  apiBase: z.string().default('https://api.telegram.org').description('Telegram Bot API origin.'),
  holdSeconds: z.natural().min(1).max(50).default(50).description('Long-poll hold (s).'),
  requestTimeoutMs: z.natural().min(1000).default(15_000).description('Bot API call timeout (ms).'),
  retryDelaysMs: z.array(z.natural()).default([2_000, 10_000, 60_000]).description('Backoff between polling failures (ms).'),
  staleAfterMinutes: z.natural().min(1).default(10).description('Refuse messages older than this (min).'),
  pairCodeTtlMinutes: z.natural().min(1).default(10).description('Pairing code lifetime (min).'),
  maxWrongPairCodes: z.natural().min(1).default(5).description('Wrong pairing codes before the code is withdrawn.'),
  muxReopenDelayMs: z.natural().default(2_000).description('Wait before reopening the approvals stream (ms).'),
})

/**
 * The plain-words problem the Settings row shows.
 * @param problem - the poller's problem.
 * @returns the line, or empty when there is nothing to say.
 */
export function problemText(problem: PollerProblem | undefined): string {
  return problem === undefined ? '' : PROBLEM_TEXT[problem.kind]
}

/** The Settings row's line per poller problem; a missing token shows the token field instead. */
const PROBLEM_TEXT: Readonly<Record<PollerProblem['kind'], string>> = {
  'no-token': '',
  conflict: 'Another copy of IDEalize is using this bot, so this one is not receiving messages.',
  unauthorized: 'Telegram rejected the bot token. Paste a new one from @BotFather.',
  failed: 'Telegram could not be reached. The app keeps retrying.',
}

/** What the Settings row says about a pairing stored from a group chat. */
const GROUP_PAIRING_PROBLEM = 'This bot was paired with a group chat, which anyone in the group could use, so it has stopped listening. Choose Pair and send the code from a private chat with the bot.'

/** A bot token starts with the bot's id. */
function botIdOf(token: string): string {
  return token.split(':')[0] ?? token
}

/**
 * Compose the bot: poller, relay, forwarders and routes.
 * @param ctx - the Cordis context.
 * @param config - the validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const ref = credentialRef(TOKEN_ENV)
  let scope: SettingsScope<TelegramSettings> | undefined
  const current = (): TelegramSettings => scope?.get() ?? TELEGRAM_DEFAULTS
  let botUsername = ''
  let problem: PollerProblem | undefined

  const botFor = (token: string): BotApi => new BotApi({
    token,
    apiBase: config.apiBase,
    fetchImpl: fetch,
    requestTimeoutMs: config.requestTimeoutMs,
  })
  const bot = async (): Promise<BotApi | undefined> => {
    const token = (await ctx.get('credentials')?.resolve(ref))?.value
    return token === undefined || token === '' ? undefined : botFor(token)
  }
  const report = (what: string) => (error: unknown): void => {
    ctx.logger.warn(`idealize-telegram: ${what}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const services: Services = {
    studio: () => ctx.get('idealizeStudio'),
    comm: () => ctx.get('idealizeComm'),
    agents: () => ctx.get('agents'),
  }
  // A stored pairing the bot may no longer obey sends nothing and hears nothing.
  const identity = (): { chatId: string; userId: string } | undefined => pairedIdentity(current())
  const pairedChat = (): string => identity()?.chatId ?? ''
  const pairedUser = (): string => identity()?.userId ?? ''
  const messenger = createMessenger({ bot, chatId: pairedChat })
  const typing = new Typing({ messenger, onError: report('"typing…" could not be shown') })
  ctx.effect(() => () => { typing.stop() }, 'idealize-telegram: typing indicator')
  const pairing = new Pairing(config.pairCodeTtlMinutes * 60_000, config.maxWrongPairCodes)
  // What waits for the person to press Allow in the app window, held in memory only.
  const confirmTtlMs = config.pairCodeTtlMinutes * 60_000
  let waitingToken: { token: string; botUsername: string; expiresAt: number } | undefined
  let waitingPairing: (PairingClaimant & { expiresAt: number }) | undefined
  const liveToken = (): typeof waitingToken => {
    if (waitingToken !== undefined && Date.now() > waitingToken.expiresAt) waitingToken = undefined
    return waitingToken
  }
  const livePairing = (): typeof waitingPairing => {
    if (waitingPairing !== undefined && Date.now() > waitingPairing.expiresAt) waitingPairing = undefined
    return waitingPairing
  }

  const relay = new Relay({
    messenger,
    api: () => ctx.get('apiProxy'),
    nameOf: async sessionId => nameOf(await services.comm()?.roster() ?? [], sessionId),
    enabled: () => current().forwardApprovals && pairedChat() !== '',
    reopenDelayMs: config.muxReopenDelayMs,
    onError: report('the approvals relay failed'),
  })
  const inbound = new Inbound({
    messenger,
    typing,
    services,
    relay,
    pairedChat,
    pairedUser,
    claimPairing: (claimant, code) => {
      if (scope === undefined) return Promise.resolve('no-code')
      const claim = pairing.claim(code)
      if (claim === 'confirm') waitingPairing = { ...claimant, expiresAt: Date.now() + confirmTtlMs }
      return Promise.resolve(claim)
    },
    staleAfterMs: config.staleAfterMinutes * 60_000,
  })
  const outbound = new Outbound({ messenger, services, typing, settings: () => ({ ...current(), chatId: pairedChat() }) })
  const poller = new Poller({
    holdSeconds: config.holdSeconds,
    retryDelaysMs: config.retryDelaysMs,
    bot: async () => {
      const client = await bot()
      if (client !== undefined && botUsername === '') {
        client.getMe().then((me) => { botUsername = me.username }, report('the bot name lookup failed'))
      }
      return client
    },
    onUpdate: update => inbound.handle(update),
    onProblem: (next) => { problem = next },
    onError: report('an update could not be handled'),
  })

  ctx.inject(['settings'], (settingsCtx) => {
    const registered = settingsCtx.settings.register(settingsNamespace(TELEGRAM_SETTINGS_NAMESPACE), TelegramSettingsSchema)
    scope = registered
    settingsCtx.effect(() => {
      const unwatch = registered.watch((next, prev) => {
        // A new chat or a re-enabled toggle is offered every request still pending.
        if (next.chatId !== prev.chatId || next.userId !== prev.userId || next.forwardApprovals !== prev.forwardApprovals) relay.restart()
      })
      return () => {
        unwatch()
        scope = undefined
      }
    }, 'idealize-telegram: settings watch')
  })

  ctx.inject(['credentials'], (credentialsCtx) => {
    credentialsCtx.effect(() => {
      poller.restart()
      return () => { void poller.stop() }
    }, 'idealize-telegram: poller')
    credentialsCtx.on('credentials/updated', (updated) => {
      if (String(updated) !== TOKEN_ENV) return
      botUsername = ''
      poller.restart()
    })
  })

  ctx.inject(['apiProxy'], (apiCtx) => {
    apiCtx.effect(() => {
      relay.restart()
      return () => { void relay.stop() }
    }, 'idealize-telegram: approvals relay')
  })

  ctx.on('idealize/studio-event', (event) => {
    outbound.onStudioEvent(event).catch(report('a Studio event could not be sent'))
  })

  ctx.inject(['idealizeBridge'], (bridgeCtx) => {
    bridgeCtx.effect(() => bridgeCtx.idealizeBridge.buffer.subscribe((event: BridgeEvent) => {
      outbound.onBridgeEvent(event).catch(report('an alert could not be sent'))
    }), 'idealize-telegram: bridge feed')
  })

  const status = async (): Promise<TelegramStatus> => {
    const description = await ctx.get('credentials')?.describe(ref)
    const configured = description?.configured ?? false
    const waiting = { token: liveToken(), pairing: livePairing() }
    return {
      configured,
      shadowed: configured && description?.writable === false,
      botUsername,
      paired: pairedChat() !== '',
      pairing: pairing.pending(),
      confirmToken: waiting.token === undefined ? undefined : { botUsername: waiting.token.botUsername },
      confirmPairing: waiting.pairing === undefined ? undefined : { name: waiting.pairing.name },
      problem: current().chatId !== '' && pairedChat() === '' ? GROUP_PAIRING_PROBLEM : problemText(problem),
    }
  }
  const ok = async (): Promise<RouteOutcome> => ({ status: 200, body: await status() })
  const refusal = (code: number, error: string): RouteOutcome => ({ status: code, body: { error } })

  installTelegramRoutes(ctx, {
    status,
    async setToken(token) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) return refusal(503, 'No credential store is composed, so the token cannot be saved.')
      if (token === '') {
        waitingToken = undefined
        try {
          await credentials.unset(ref)
        } catch (error) {
          return refusal(409, (error as Error).message)
        }
        return await ok()
      }
      if (!TOKEN_SHAPE.test(token)) return refusal(400, 'This does not look like a bot token. Copy the whole token @BotFather sent.')
      let username: string
      try {
        username = (await botFor(token).getMe()).username
      } catch (error) {
        if (error instanceof TelegramApiError && error.kind === 'unauthorized') {
          return refusal(400, 'Telegram did not accept this token.')
        }
        return refusal(502, 'Telegram could not be reached to check the token. Try again.')
      }
      waitingToken = { token, botUsername: username, expiresAt: Date.now() + confirmTtlMs }
      return await ok()
    },
    async confirm(what, allow) {
      if (what === 'token') {
        const waiting = liveToken()
        waitingToken = undefined
        if (waiting === undefined) return refusal(409, 'Nothing is waiting. Paste the token again.')
        if (!allow) return await ok()
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return refusal(503, 'No credential store is composed, so the token cannot be saved.')
        const previous = (await credentials.resolve(ref))?.value
        try {
          await credentials.set(ref, waiting.token)
        } catch (error) {
          // The store refuses a write the launching environment would shadow.
          return refusal(409, (error as Error).message)
        }
        botUsername = waiting.botUsername
        // A different bot is a different party reading the chat, so the old pairing does not carry over.
        if (previous !== undefined && botIdOf(previous) !== botIdOf(waiting.token)) {
          pairing.cancel()
          waitingPairing = undefined
          await scope?.update({ chatId: '', userId: '' })
        }
        return await ok()
      }
      const waiting = livePairing()
      waitingPairing = undefined
      if (waiting === undefined) return refusal(409, 'Nothing is waiting. Choose Pair for a new code.')
      if (!allow) {
        await messenger.send(PAIR_REPLIES.declined, undefined, waiting.chatId)
        return await ok()
      }
      if (scope === undefined) return refusal(503, 'No settings store is composed, so a pairing cannot be kept.')
      await scope.update({ chatId: waiting.chatId, userId: waiting.userId })
      await messenger.send(PAIR_REPLIES.paired, undefined, waiting.chatId)
      return await ok()
    },
    async pair() {
      if (!(await status()).configured) return refusal(400, 'Save a bot token first.')
      if (scope === undefined) return refusal(503, 'No settings store is composed, so a pairing cannot be kept.')
      pairing.issue()
      return await ok()
    },
    async unpair() {
      pairing.cancel()
      waitingPairing = undefined
      await scope?.update({ chatId: '', userId: '' })
      return await ok()
    },
  })
}
