/** General Settings row for the Telegram remote: token, pairing, and what the bot forwards. */
import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { FORWARD_KEYS, type ForwardKey, type TelegramStatus } from '../settings.ts'
import css from './TelegramRow.module.css'

/** What the row renders. */
export interface TelegramRowState {
  /** The host's answer; undefined until the first read. */
  status: TelegramStatus | undefined
  forward: Record<ForwardKey, boolean>
  /** A route call is in flight. */
  busy: boolean
  /** The last route refusal, in the host's words; empty when none. */
  error: string
}

/** Registration-side face. */
export interface TelegramRowInjected {
  hooks: {
    telegram: SnapshotStore<TelegramRowState>
  }
  /** Re-read the host status. */
  refresh: () => void
  /** Check and store a token; empty removes it. */
  saveToken: (token: string) => void
  pair: () => void
  unpair: () => void
  setForward: (key: ForwardKey, value: boolean) => void
}

/** Full Settings-row props. */
export type TelegramRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'idealize-telegram'>
  & InjectFace<TelegramRowInjected>

/**
 * Render the Telegram remote row.
 * @param props - composed Settings slot props.
 */
export function TelegramRow({ useTelegram, refresh, saveToken, pair, unpair, setForward, t }: TelegramRowProps) {
  const state = useTelegram(value => value)
  const [token, setToken] = useState('')
  useEffect(() => { refresh() }, [refresh])
  const status = state.status
  const problem = state.error !== '' ? state.error : status?.problem ?? ''

  return (
    <div className={css.row} data-telegram-row>
      <div className={css.rowText}>
        <div className={css.title}>{t('telegram.title')}</div>
        <div className={css.desc}>{t('telegram.description')}</div>
      </div>

      {status !== undefined && !status.configured && (
        <form
          className={css.controls}
          onSubmit={(event) => {
            event.preventDefault()
            saveToken(token)
            setToken('')
          }}
        >
          <input
            type="password"
            className={css.input}
            value={token}
            autoComplete="off"
            aria-label={t('telegram.token.label')}
            placeholder={t('telegram.token.placeholder')}
            onChange={(event) => { setToken(event.currentTarget.value) }}
          />
          <button type="submit" className={css.button} disabled={state.busy || token.trim() === ''}>
            {t('telegram.token.save')}
          </button>
        </form>
      )}

      {status?.configured === true && (
        <>
          <div className={css.controls}>
            <span className={css.line}>
              {t('telegram.connected')} {status.botUsername === '' ? '' : `@${status.botUsername}`}
            </span>
            {status.shadowed
              ? <span className={css.hint}>{t('telegram.token.shadowed')}</span>
              : (
                <button type="button" className={css.button} disabled={state.busy} onClick={() => { saveToken('') }}>
                  {t('telegram.token.remove')}
                </button>
              )}
          </div>

          {status.paired
            ? (
              <>
                <div className={css.controls}>
                  <span className={css.line}>{t('telegram.paired')}</span>
                  <button type="button" className={css.button} disabled={state.busy} onClick={unpair}>
                    {t('telegram.unpair')}
                  </button>
                </div>
                {FORWARD_KEYS.map(key => (
                  <div key={key} className={css.controls}>
                    <span className={css.line}>{t(`telegram.forward.${key}`)}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={state.forward[key]}
                      aria-label={t(`telegram.forward.${key}`)}
                      className={css.switch}
                      onClick={() => { setForward(key, !state.forward[key]) }}
                    />
                  </div>
                ))}
              </>
            )
            : (
              <div className={css.controls}>
                {status.pairing === undefined
                  ? (
                    <button type="button" className={css.button} disabled={state.busy} onClick={pair}>
                      {t('telegram.pair')}
                    </button>
                  )
                  : (
                    <span className={css.line} data-pairing-code>
                      {t('telegram.pair.send')} <code className={css.code}>/pair {status.pairing.code}</code> {t('telegram.pair.expires')}
                    </span>
                  )}
              </div>
            )}
        </>
      )}

      {problem !== '' && <div className={css.problem} role="status">{problem}</div>}
    </div>
  )
}
