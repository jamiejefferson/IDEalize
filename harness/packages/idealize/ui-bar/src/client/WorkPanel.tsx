/**
 * The Time & cost drawer pane (feedback 546cf075, filed from 1.0.9: "a
 * 'working time' tracker on projects … alongside the model cost, so it's
 * possible to do a calculation of time and cost associated with projects").
 *
 * Top, the totals: working time this month (today beneath it) and what the
 * models cost this month, from `GET /idealize/models/work`. One line under
 * them states the rule: working time counts the minutes a project's chats
 * spend answering, plus pauses under five minutes between turns, so the
 * person reading and typing between turns is counted and a lunch break is
 * not. Then one row per project: its working time this month and all time,
 * and its month cost, which is what its metered tokens cost at the known
 * prices; subscription plans belong to no one project, so they reach the
 * total alone and a note says so when they are in it. Cost is never
 * estimated: with no price or plan cost known the cost cells stay a dash
 * under a hint.
 *
 * Beneath, the Budget section (BudgetSection.tsx): the per-category token
 * table with its project scope, the per-model spend with price editing, the
 * generations table and the monthly budget. It moved here from the Brains
 * pane so time and money sit on one screen.
 */
import { useEffect, useState } from 'react'
import { BudgetSection } from './BudgetSection.tsx'
import { duration, money, providerDisplayName } from './format.ts'
import type { BarKey } from './locales.ts'
import { SectionHead } from './SectionHead.tsx'
import brains from './BrainsPanel.module.css'
import css from './WorkPanel.module.css'

/** Working seconds per period, as the work route reports them. */
interface WorkTime {
  today: number
  month: number
  all: number
}

/** The GET /idealize/models/work payload (host half of @idealize/models). */
interface WorkState {
  projects: { path: string; label: string; time: WorkTime; cost: { month: number }; tokens: { month: number } }[]
  totals: { time: WorkTime; cost: { month: number; plans: number }; tokens: { month: number } }
  currency: string
  costConfigured: boolean
}

/** The slice of GET /idealize/models/state the pane reads: each route's display name. */
interface NamesState {
  providers: { provider: string; displayName?: string }[]
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url)
    return response.ok ? await response.json() as T : null
  } catch {
    return null
  }
}

/**
 * Render the Time & cost pane.
 * @param props.t - bar copy.
 * @returns the pane element tree.
 */
export function WorkPanel({ t }: { t: (key: BarKey, params?: Record<string, string | number>) => string }) {
  /** Null while loading; `failed` when the route could not be read. */
  const [work, setWork] = useState<WorkState | 'failed' | null>(null)
  const [names, setNames] = useState<NamesState | null>(null)

  useEffect(() => {
    let cancelled = false
    void getJson<WorkState>('/idealize/models/work').then((state) => { if (!cancelled) setWork(state ?? 'failed') })
    void getJson<NamesState>('/idealize/models/state').then((state) => { if (!cancelled) setNames(state) })
    return () => { cancelled = true }
  }, [])

  const providerName = (provider: string): string =>
    providerDisplayName(provider, names?.providers.find(row => row.provider === provider)?.displayName)
  const state = work === 'failed' ? null : work
  const cost = (value: number): string => state === null || !state.costConfigured ? '—' : money(value, state.currency)

  return (
    <div className={css.root} data-work-panel="">
      <div className={css.totals} data-work-totals="">
        <div className={css.total}>
          <span className={css.totalLabel}>{t('work.totals.time')}</span>
          <strong className={css.totalValue} data-work-month="">{state === null ? '—' : duration(state.totals.time.month)}</strong>
          <small className={css.totalNote} data-work-today="">
            {state === null ? '' : t('work.totals.today', { time: duration(state.totals.time.today) })}
          </small>
        </div>
        <div className={css.total}>
          <span className={css.totalLabel}>{t('work.totals.cost')}</span>
          <strong className={css.totalValue} data-work-cost="">{state === null ? '—' : cost(state.totals.cost.month)}</strong>
          <small className={css.totalNote}>
            {state !== null && state.costConfigured && state.totals.cost.plans > 0
              ? t('work.totals.plans', { amount: money(state.totals.cost.plans, state.currency) })
              : ''}
          </small>
        </div>
      </div>
      <p className={css.rule}>{t('work.rule')}</p>
      {work === 'failed' && <p className={brains.note} role="status" data-work-failed="">{t('work.failed')}</p>}

      <SectionHead title={t('work.projects.title')} detail={t('work.projects.detail')} />
      <div className={brains.table} role="table" aria-label={t('work.projects.title')} data-work-projects="">
        <div className={brains.tableHead} role="row">
          <span className={brains.colCategory}>{t('work.col.project')}</span>
          <span className={`${css.colTime} ${css.colHead}`}>{t('work.col.month')}</span>
          <span className={`${css.colTime} ${css.colHead}`}>{t('work.col.all')}</span>
          <span className={`${css.colCost} ${css.colHead}`}>{t('work.col.cost')}</span>
        </div>
        {state !== null && state.projects.length === 0 && <div className={brains.emptyRow}>{t('work.projects.none')}</div>}
        {(state?.projects ?? []).map(project => (
          <div key={project.path} className={brains.tableRow} role="row" data-work-project={project.path}>
            <span className={brains.colCategory}>
              <strong>{project.label}</strong>
              <small>{project.path}</small>
            </span>
            <span className={css.colTime} data-work-project-month="">{duration(project.time.month)}</span>
            <span className={css.colTime} data-work-project-all="">{duration(project.time.all)}</span>
            <span className={css.colCost} data-work-project-cost="">{cost(project.cost.month)}</span>
          </div>
        ))}
      </div>
      {state !== null && !state.costConfigured && <p className={brains.note} data-work-no-prices="">{t('work.noPrices')}</p>}

      <BudgetSection providerName={providerName} t={t} />
    </div>
  )
}
