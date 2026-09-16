/**
 * @idealize/telegram, browser half: the Telegram remote row in General
 * settings. The row reads the host status route, stores a token through the
 * token route (the token never enters the settings document), issues and
 * withdraws pairing codes, and flips the forward toggles in the
 * `idealize-telegram` settings section. While a pairing code is live it
 * re-reads the status so the row turns to "paired" once the phone sends the
 * code.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the ctx.settingsScope Context merge and the settings slots.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FORWARD_KEYS, TELEGRAM_DEFAULTS, TELEGRAM_SETTINGS_NAMESPACE, type ForwardKey, type TelegramSettings } from '../settings.ts'
import { telegramCall } from './api.ts'
import { TelegramRow, type TelegramRowInjected, type TelegramRowState } from './TelegramRow.tsx'
import { en, zh, type TelegramKey } from './locales.ts'

export { TelegramRow } from './TelegramRow.tsx'
export type { TelegramKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Telegram remote row's copy. */
    'idealize-telegram': TelegramKey
  }
}

const NS = 'idealize-telegram'
const STATUS_PATH = '/idealize/telegram/status'
const TOKEN_PATH = '/idealize/telegram/token'
const PAIR_PATH = '/idealize/telegram/pair'

/** How often the row re-reads the status while a pairing code waits to be sent. */
const PAIRING_REFRESH_MS = 2_000

/** Required services. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-telegram: dictionaries')

  const scope = ctx.settingsScope.bind<TelegramSettings>({ namespace: TELEGRAM_SETTINGS_NAMESPACE })
  const forward = (): Record<ForwardKey, boolean> => {
    const settings = { ...TELEGRAM_DEFAULTS, ...scope.getSnapshot().value }
    return Object.fromEntries(FORWARD_KEYS.map(key => [key, settings[key]])) as Record<ForwardKey, boolean>
  }
  const store = createSnapshotStore<TelegramRowState>({ status: undefined, forward: forward(), busy: false, error: '' })
  ctx.effect(() => scope.subscribe(() => { store.set({ ...store.getSnapshot(), forward: forward() }) }), 'idealize-telegram: settings')

  const run = async (call: () => Promise<Awaited<ReturnType<typeof telegramCall>>>): Promise<void> => {
    store.set({ ...store.getSnapshot(), busy: true, error: '' })
    try {
      const status = await call()
      store.set({ ...store.getSnapshot(), status, busy: false })
    } catch (error) {
      store.set({ ...store.getSnapshot(), busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const refresh = (): void => { void run(() => telegramCall('GET', STATUS_PATH)) }

  ctx.effect(() => {
    const timer = setInterval(() => {
      if (store.getSnapshot().status?.pairing !== undefined) refresh()
    }, PAIRING_REFRESH_MS)
    return () => { clearInterval(timer) }
  }, 'idealize-telegram: pairing refresh')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'idealize-telegram',
    order: 60,
    locale: NS,
    inject: (): TelegramRowInjected => ({
      hooks: { telegram: store },
      refresh,
      saveToken: (token) => { void run(() => telegramCall('POST', TOKEN_PATH, { token })) },
      pair: () => { void run(() => telegramCall('POST', PAIR_PATH)) },
      unpair: () => { void run(() => telegramCall('DELETE', PAIR_PATH)) },
      setForward: (key, value) => {
        store.set({ ...store.getSnapshot(), forward: { ...store.getSnapshot().forward, [key]: value } })
        void scope.set(key, value)
      },
    }),
  }, TelegramRow))
}
