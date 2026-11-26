/**
 * The Models pane's "Recent model changes" disclosure: the last turns the
 * model router read, each with the model it stayed on or moved to and the
 * router's one-sentence reason. The router's settings live on the chat box,
 * so this file keeps only its log. The log is read from
 * `GET /idealize/router/log` of @idealize/router each time the disclosure
 * opens; a host without the route shows the empty line.
 */
import { useState } from 'react'
import type { BarKey } from './locales.ts'
import css from './BrainsPanel.module.css'

/** One line of /idealize/router/log. */
interface LogRow {
  at: string
  from: string
  to: string
  switched: boolean
  rationale: string
  reading: { source: 'jev' | 'rules' | 'brain' }
}

/** How many turns the disclosure lists. */
const LOG_ROWS = 8

async function readLog(): Promise<LogRow[]> {
  try {
    const response = await fetch(`/idealize/router/log?limit=${String(LOG_ROWS)}`)
    if (!response.ok) return []
    const body = await response.json() as { entries?: LogRow[] }
    return Array.isArray(body.entries) ? body.entries : []
  } catch {
    return []
  }
}

/** A route id without its provider prefix, which the pane's other tables also drop. */
const modelOf = (route: string): string => route.slice(route.indexOf('/') + 1)

/**
 * Render the router's recent decisions behind a disclosure.
 * @param props.t - bar copy.
 * @returns the disclosure's element tree.
 */
export function RecentModelChanges({ t }: {
  t: (key: BarKey, params?: Record<string, string | number>) => string
}) {
  const [log, setLog] = useState<LogRow[] | null>(null)
  return (
    <details
      className={css.behindScenes}
      data-router-how=""
      onToggle={(event) => { if (event.currentTarget.open) void readLog().then(setLog) }}
    >
      <summary className={css.behindSummary}>{t('models.changes.title')}</summary>
      <p className={css.behindDetail}>{t('brains.router.log.detail')}</p>
      <div className={css.table} role="table" aria-label={t('models.changes.title')} data-router-log="">
        {log !== null && log.length === 0 && <div className={css.emptyRow}>{t('brains.router.log.none')}</div>}
        {(log ?? []).map(row => (
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
  )
}
