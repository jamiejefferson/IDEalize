/**
 * The Brains pane's Auto-switch tab (Paper "Brains rethink", board 11): three
 * plain switches first, and how it decides one click down. How readily a chat
 * moves and what "better" weighs belong to each brain, in its sheet (JJ, 21 Sep
 * 2026). Where it cannot run the tab says what it needs and no switch stays
 * ticked (router ruling 9: no Jev reading means no switch). Reads and writes
 * the loopback routes of @idealize/router.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
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
export function RouterTab({ t, onConnect }: {
  t: (key: BarKey, params?: Record<string, string | number>) => string
  onConnect?: () => void
}) {
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
  // The switches are the person's settings, and the file keeps them, so a
  // missing account shows them off without writing anything.
  const needsAccount = state !== null && state.settings.useJev && !state.jev.keyed
  const canRun = state !== null && !needsAccount && state.candidates >= 2
  const off = !canRun || !state.settings.enabled
  const row = (flag: 'enabled' | Flag, disabled: boolean, labelKey: BarKey, hintKey: BarKey): ReactNode => (
    <label key={flag} className={css.settingRow}>
      <span className={css.settingText}>
        <span>{t(labelKey)}</span>
        <small className={css.fieldHint}>{t(hintKey)}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        className={css.switch}
        data-router-flag={flag}
        checked={canRun && state.settings[flag]}
        disabled={disabled}
        onChange={(event) => { void save('/idealize/router/settings', { [flag]: event.target.checked }) }}
      />
    </label>
  )

  return (
    <div data-router-tab="">
      {needsAccount && (
        <div className={css.readiness} data-router-no-key="">
          <span>{t('brains.router.noKey')}</span>
          {onConnect !== undefined && <button type="button" className={css.primary} onClick={onConnect}>{t('brains.router.connect')}</button>}
        </div>
      )}
      {state !== null && !needsAccount && state.candidates < 2 && <p className={css.note} data-router-one-model="">{t('brains.router.oneModel')}</p>}
      <p className={css.note} data-router-reads="">{t('brains.router.reads')}</p>
      <div className={css.settings}>
        {row('enabled', !canRun, 'brains.router.enabled', 'brains.router.enabledHint')}
        {FLAGS.map(flag => row(flag, off, `brains.router.${flag}`, `brains.router.${flag}Hint`))}
      </div>
      {state !== null && state.settings.useJev && state.jev.keyed && state.jev.lastFailure !== undefined && (
        <p className={css.note} data-router-jev-failure={state.jev.lastFailure.failure}>
          {t(`brains.router.jev.${state.jev.lastFailure.failure}`)}
        </p>
      )}
      {state?.scoresUnreadable === true && <p className={css.note} data-router-scores-unreadable="">{t('brains.router.scoresUnreadable')}</p>}
      {failed && <p className={css.note} role="alert">{t('brains.prefs.failed')}</p>}

      <details className={css.behindScenes} data-router-how="">
        <summary className={css.behindSummary}>{t('brains.router.how')}</summary>
        <p className={css.behindDetail}>{t('brains.router.detail')}</p>
        <p className={css.behindDetail} data-router-per-brain="">{t('brains.router.perBrain')}</p>
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
      </details>
    </div>
  )
}
