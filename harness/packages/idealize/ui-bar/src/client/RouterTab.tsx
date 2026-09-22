/**
 * The Brains pane's Router tab: whether chats are moved to a better model,
 * and what the router did lately. How readily a chat moves and what "better"
 * weighs belong to each brain, in its sheet (JJ, 21 Sep 2026). Reads and
 * writes the loopback routes of @idealize/router.
 */
import { useCallback, useEffect, useState } from 'react'
import type { BarKey } from './locales.ts'
import css from './BrainsPanel.module.css'

const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

const FLAGS = ['preferFree', 'showRationale'] as const
type Flag = typeof FLAGS[number]

const JEV_FAILURES = ['no-key', 'refused-key', 'no-credit', 'rate-limited', 'timeout', 'unreachable', 'unreadable'] as const
type JevFailure = typeof JEV_FAILURES[number]

/** The /idealize/router/state payload, as far as the tab reads it. */
interface RouterState {
  settings: { enabled: boolean; useJev: boolean } & Record<Flag, boolean>
  jev: { keyed: boolean; lastFailure?: { failure: JevFailure; at: string } }
  candidates: number
  /** The user's own score file exists and could not be read, so the shipped table alone is in use. */
  scoresUnreadable?: boolean
}

/** One line of /idealize/router/log. */
interface LogRow {
  at: string
  from: string
  to: string
  switched: boolean
  recommended?: string
  rationale: string
  reading: { source: 'jev' | 'rules' | 'brain' }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? await response.json() as T : null
  } catch {
    return null
  }
}

async function post(url: string, body: unknown): Promise<boolean> {
  try {
    return (await fetch(url, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })).ok
  } catch {
    return false
  }
}

/** A route id without its provider prefix, which the pane's other tables also drop. */
const modelOf = (route: string): string => route.slice(route.indexOf('/') + 1)

/**
 * Render the Router tab.
 * @param props.t - bar copy.
 * @returns the tab's element tree.
 */
export function RouterTab({ t }: { t: (key: BarKey, params?: Record<string, string | number>) => string }) {
  const [state, setState] = useState<RouterState | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    const next = await getJson<RouterState>('/idealize/router/state')
    if (next !== null) setState(next)
    setLog((await getJson<{ entries: LogRow[] }>('/idealize/router/log?limit=8'))?.entries ?? [])
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const save = async (url: string, body: unknown): Promise<void> => {
    setFailed(!(await post(url, body)))
    await refresh()
  }
  const off = state === null || !state.settings.enabled

  return (
    <div data-router-tab="">
      <div className={css.sectionHead}>
        <div>
          <div className={css.sectionTitle}>{t('brains.router.title')}</div>
          <div className={css.sectionDetail}>{t('brains.router.detail')}</div>
        </div>
      </div>
      <div className={css.field}>
        <label className={css.choice}>
          <input
            type="checkbox"
            data-router-flag="enabled"
            checked={state?.settings.enabled ?? false}
            disabled={state === null}
            onChange={(event) => { void save('/idealize/router/settings', { enabled: event.target.checked }) }}
          />
          {t('brains.router.enabled')}
        </label>
        <span className={css.fieldHint}>{t('brains.router.enabledHint')}</span>
        <span className={css.fieldHint} data-router-per-brain="">{t('brains.router.perBrain')}</span>
      </div>
      {FLAGS.map(flag => (
        <div key={flag} className={css.field}>
          <label className={css.choice}>
            <input
              type="checkbox"
              data-router-flag={flag}
              checked={state?.settings[flag] ?? false}
              disabled={off}
              onChange={(event) => { void save('/idealize/router/settings', { [flag]: event.target.checked }) }}
            />
            {t(`brains.router.${flag}`)}
          </label>
          <span className={css.fieldHint}>{t(`brains.router.${flag}Hint`)}</span>
        </div>
      ))}
      {state !== null && state.settings.useJev && !state.jev.keyed && (
        <p className={css.note} data-router-no-key="">{t('brains.router.noKey')}</p>
      )}
      {state !== null && state.settings.useJev && state.jev.keyed && state.jev.lastFailure !== undefined && (
        <p className={css.note} data-router-jev-failure={state.jev.lastFailure.failure}>
          {t(`brains.router.jev.${state.jev.lastFailure.failure}`)}
        </p>
      )}
      {state !== null && state.candidates < 2 && <p className={css.note} data-router-one-model="">{t('brains.router.oneModel')}</p>}
      {state?.scoresUnreadable === true && <p className={css.note} data-router-scores-unreadable="">{t('brains.router.scoresUnreadable')}</p>}
      {failed && <p className={css.note} role="alert">{t('brains.prefs.failed')}</p>}

      <div className={css.sectionHead}>
        <div>
          <div className={css.sectionTitle}>{t('brains.router.log.title')}</div>
          <div className={css.sectionDetail}>{t('brains.router.log.detail')}</div>
        </div>
      </div>
      <div className={css.table} role="table" aria-label={t('brains.router.log.title')} data-router-log="">
        {log.length === 0 && <div className={css.emptyRow}>{t('brains.router.log.none')}</div>}
        {log.map(row => (
          <div key={`${row.at}${row.from}`} className={css.tableRow} role="row" data-router-log-row={row.switched ? 'switched' : 'stayed'}>
            <span className={css.colCategory}>
              <strong>
                {row.switched
                  ? t('brains.router.log.switched', { from: modelOf(row.from), to: modelOf(row.to) })
                  : t('brains.router.log.stayed', { model: modelOf(row.to) })}
              </strong>
              <small>{row.rationale}</small>
            </span>
            <span className={css.colPeriod}>
              {new Date(row.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              <small>{t(`brains.router.log.source.${row.reading.source}`)}</small>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
