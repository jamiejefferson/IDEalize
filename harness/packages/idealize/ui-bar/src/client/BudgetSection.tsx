/**
 * The Budget section of the Time & cost pane (it was the Brains pane's
 * Budget tab until 24 Sep 2026, when working time joined it): month-to-date
 * and year-to-date tokens per billing category, overall or for one project,
 * against the monthly token budget. When the host has token prices or
 * subscription plan costs configured (idealize-models settings), each cell
 * leads with the cost those prices compute and notes call out any usage they
 * leave unpriced; costs are never estimated, so with nothing configured the
 * cells stay token-only under a hint. Beneath, one row per model with usage
 * this month: its tokens and, for a metered route, its cost where a price
 * exists or a Set price action where none does. The action opens an inline
 * editor for the input and output prices per million tokens (cache read and
 * write under "more"), saved through `POST /idealize/models/prices`; a row
 * OpenRouter priced from its published directory says so, and a typed price
 * wins over it. The total sums the priced rows and counts the unpriced ones.
 * A Generations table follows, one row per endpoint that generated this
 * month with what fal billed for it.
 *
 * Reads `GET /idealize/models/usage?scope=` and writes the prices and budget
 * routes of @idealize/models.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { money, tokens, when } from './format.ts'
import type { BarKey } from './locales.ts'
import { SectionHead } from './SectionHead.tsx'
import css from './BrainsPanel.module.css'

/** Mutating /idealize routes require the auth marker (host route fence). */
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

type Totals = Record<'subscriptions' | 'metered' | 'free' | 'total', number>

/**
 * The usage payload's cost half, computed by the host from user-configured
 * token prices and subscription plan costs only. `configured` false means
 * nothing is priced yet, and the section shows a hint instead of zero costs;
 * the unpriced fields name what the shown costs leave out.
 */
interface CostState {
  currency: string
  month: Totals
  year: Totals
  unpricedTokens: { month: number; year: number }
  unpricedSubscriptions: string[]
  configured: boolean
}

/** One model's token prices per million, with who supplied them. */
interface PricedModel {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  source: 'user' | 'market' | 'catalogue'
}

/** One model with usage this month, as the usage payload lists it. */
interface ModelCostRow {
  provider: string
  model: string
  category: 'subscriptions' | 'metered' | 'free'
  total: number
  /** This month's cost; only a metered route with a price carries one. */
  cost?: number
  price?: PricedModel
}

/** The /idealize/models/usage payload. */
interface UsageState {
  scope: string
  projects: { path: string; label: string }[]
  month: Totals
  year: Totals
  monthlyTokenBudget: number
  cost: CostState
  models?: ModelCostRow[]
  /** OpenRouter's published price list, when the route is connected: when it was read and how many models it prices. */
  openRouterPrices?: { fetchedAt: string; models: number } | null
  /** What was generated this month per endpoint, with what fal billed for it. */
  generations?: GenerationState
  /** fal's usage report, when a key for fal is stored: when it was read, and why a read failed. */
  falUsage?: { fetchedAt: string | null; error?: string } | null
}

/** One endpoint's generations this month, as the usage payload lists them. */
interface GenerationRow {
  provider: string
  /** The endpoint id (`fal-ai/flux/dev`). */
  model: string
  /** The artefacts' media type; absent for an endpoint only fal reported. */
  mediaType?: string
  /** Artefacts this app made this month. */
  count: number
  /** What fal billed this month, in fal's own currency. */
  billed?: { quantity: number; unit: string; cost: number; currency: string }
}

/** The usage payload's generation half. */
interface GenerationState {
  rows: GenerationRow[]
  /** Billed totals per currency, this month and year to date; absent while fal has reported nothing. */
  billed?: { month: Record<string, number>; year: Record<string, number> }
  /** The currency fal billed in, null while it has billed nothing. */
  currency: string | null
}

/** The inline price editor's fields, as typed; `more` opens the cache prices. */
interface PriceDraft {
  provider: string
  model: string
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
  more: boolean
}

const CATEGORIES = ['subscriptions', 'metered', 'free', 'total'] as const

/**
 * The media kind a generation row names, from the artefact's media type: the
 * type before the slash, which the copy has a word for. A row fal reported
 * that this app did not make carries no media type and reads as items.
 */
function mediaKind(mediaType: string | undefined): 'image' | 'video' | 'audio' | 'other' {
  const top = (mediaType ?? '').split('/')[0]
  if (top === 'image' || top === 'video' || top === 'audio') return top
  return 'other'
}

/** A price field as typed, to a non-negative number; undefined when it is not one. */
function priceNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) && value >= 0 ? value : undefined
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

/**
 * Render the Budget section.
 * @param props.providerName - a route's display name, by the pane's one rule.
 * @param props.t - bar copy.
 * @returns the section's element tree.
 */
export function BudgetSection({ providerName, t }: {
  providerName: (provider: string) => string
  t: (key: BarKey, params?: Record<string, string | number>) => string
}) {
  const [usage, setUsage] = useState<UsageState | null>(null)
  const [scope, setScope] = useState('')
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null)
  /** The model row whose price is being edited, and the figures typed so far. */
  const [priceDraft, setPriceDraft] = useState<PriceDraft | null>(null)
  const [status, setStatus] = useState('')

  const refreshUsage = useCallback(async (path: string) => {
    setUsage(await getJson<UsageState>(`/idealize/models/usage?scope=${encodeURIComponent(path)}`))
  }, [])
  useEffect(() => { void refreshUsage(scope) }, [scope, refreshUsage])

  /** One period cell: the cost from configured prices over the token count, or tokens alone while nothing is priced. */
  const periodCell = (period: 'month' | 'year', category: typeof CATEGORIES[number]): ReactNode => {
    if (usage === null) return '—'
    const count = tokens(usage[period][category])
    if (!usage.cost.configured) return count
    return (
      <span className={css.cellCost} data-budget-cost={`${period}-${category}`}>
        <strong>{money(usage.cost[period][category], usage.cost.currency)}</strong>
        <small>{count}</small>
      </span>
    )
  }
  /**
   * What the price editor says beneath its fields: where the price it shows
   * came from, or, with no price yet, how to type one.
   */
  const priceHint = (row: ModelCostRow, cost: CostState, openRouterPrices: UsageState['openRouterPrices']): string => {
    if (row.price?.source === 'market' && openRouterPrices != null) {
      return t('brains.prices.source.openrouter', { time: when(openRouterPrices.fetchedAt) })
    }
    if (row.price?.source === 'catalogue') return t('brains.prices.source.catalogue')
    return t('brains.prices.hint', { currency: cost.currency })
  }
  /** Open the inline editor on a model row, seeded with the price it has. */
  const beginPrice = (row: ModelCostRow): void => {
    const price = row.price
    setPriceDraft({
      provider: row.provider,
      model: row.model,
      input: price === undefined ? '' : String(price.input),
      output: price === undefined ? '' : String(price.output),
      cacheRead: price === undefined ? '' : String(price.cacheRead),
      cacheWrite: price === undefined ? '' : String(price.cacheWrite),
      more: false,
    })
  }
  /**
   * Save the editor's figures as the model's price. Input and output are
   * required; a cache price left blank takes the input price, which is what
   * a service with no cache discount charges — no kind is ever saved as free
   * by omission.
   */
  const savePrice = async (): Promise<void> => {
    if (priceDraft === null) return
    const input = priceNumber(priceDraft.input)
    const output = priceNumber(priceDraft.output)
    if (input === undefined || output === undefined) {
      setStatus(t('brains.prices.incomplete'))
      return
    }
    const price = {
      input,
      output,
      cacheRead: priceNumber(priceDraft.cacheRead) ?? input,
      cacheWrite: priceNumber(priceDraft.cacheWrite) ?? input,
    }
    const ok = await post('/idealize/models/prices', { provider: priceDraft.provider, model: priceDraft.model, price })
    setStatus(ok ? t('brains.prices.saved') : t('brains.prices.failed'))
    if (ok) {
      setPriceDraft(null)
      await refreshUsage(scope)
    }
  }
  const saveBudget = async (): Promise<void> => {
    if (budgetDraft === null) return
    const value = Number(budgetDraft.replace(/[^0-9]/g, ''))
    const ok = await post('/idealize/models/budget', { monthlyTokenBudget: value })
    setStatus(ok ? t('brains.budget.saved') : t('brains.budget.failed'))
    if (ok) {
      setBudgetDraft(null)
      await refreshUsage(scope)
    }
  }

  return (
    <>
      <SectionHead title={t('brains.budget.title')} detail={t('brains.budget.detail')} />
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('brains.budget.view')}</span>
        <select className={css.fieldSelect} value={scope} onChange={(event) => { setScope(event.target.value) }}>
          <option value="">{t('brains.budget.overall')}</option>
          {(usage?.projects ?? []).map(project => (
            <option key={project.path} value={project.path}>{project.label}</option>
          ))}
        </select>
      </label>
      <div className={css.table} role="table" aria-label={t('brains.budget.title')}>
        <div className={css.tableHead} role="row">
          <span className={css.colCategory}>{t('brains.budget.category')}</span>
          <span className={css.colPeriod}>{t('brains.budget.month')}</span>
          <span className={css.colPeriod}>{t('brains.budget.year')}</span>
        </div>
        {CATEGORIES.map(category => (
          <div key={category} className={category === 'total' ? css.tableTotal : css.tableRow} role="row">
            <span className={css.colCategory}>
              <strong>{t(`brains.category.${category}`)}</strong>
              <small>{t(`brains.category.${category}.detail`)}</small>
            </span>
            <span className={css.colPeriod}>{periodCell('month', category)}</span>
            <span className={css.colPeriod}>{periodCell('year', category)}</span>
          </div>
        ))}
      </div>
      {usage !== null && !usage.cost.configured && (
        <p className={css.note} data-budget-no-prices="">{t('brains.budget.noPrices')}</p>
      )}
      {usage !== null && usage.cost.configured && usage.cost.unpricedSubscriptions.length > 0 && (
        <p className={css.note} data-budget-unpriced-subs="">
          {t('brains.budget.unpricedSubs', { providers: usage.cost.unpricedSubscriptions.map(providerName).join(', ') })}
        </p>
      )}
      {usage !== null && usage.cost.configured && usage.cost.unpricedTokens.year > 0 && (
        <p className={css.note} data-budget-unpriced-tokens="">
          {t('brains.budget.unpricedTokens', { tokens: tokens(usage.cost.unpricedTokens.year) })}
        </p>
      )}
      {usage !== null && (
        <>
          <SectionHead title={t('brains.spend.title')} detail={t('brains.spend.detail')} />
          <div className={css.table} role="table" aria-label={t('brains.spend.title')} data-spend-models="">
            <div className={css.tableHead} role="row">
              <span className={css.colCategory}>{t('brains.spend.model')}</span>
              <span className={css.colPeriod}>{t('brains.spend.tokens')}</span>
              <span className={css.colCost}>{t('brains.spend.cost')}</span>
            </div>
            {(usage.models ?? []).length === 0 && <div className={css.emptyRow}>{t('brains.spend.none')}</div>}
            {(usage.models ?? []).map((row) => {
              const key = `${row.provider} ${row.model}`
              const editing = priceDraft !== null && priceDraft.provider === row.provider && priceDraft.model === row.model
              return (
                <Fragment key={key}>
                  <div className={css.tableRow} role="row" data-spend-model={key} data-spend-category={row.category}>
                    <span className={css.colCategory}>
                      <strong>{row.model === '' ? t('brains.agent.default') : row.model}</strong>
                      <small>{providerName(row.provider)}</small>
                    </span>
                    <span className={css.colPeriod}>{tokens(row.total)}</span>
                    <span className={css.colCost}>
                      {row.category === 'subscriptions' && <small>{t('brains.spend.plan')}</small>}
                      {row.category === 'free' && <small>{t('brains.spend.free')}</small>}
                      {row.category === 'metered' && row.cost !== undefined && (
                        <>
                          <strong data-spend-cost={key}>{money(row.cost, usage.cost.currency)}</strong>
                          <button type="button" className={css.priceLink} onClick={() => { beginPrice(row) }}>
                            {t('brains.spend.editPrice')}
                          </button>
                        </>
                      )}
                      {row.category === 'metered' && row.cost === undefined && (
                        <>
                          <span data-spend-unpriced={key}>—</span>
                          <button type="button" className={css.priceLink} onClick={() => { beginPrice(row) }}>
                            {t('brains.spend.setPrice')}
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  {editing && (
                    <div className={css.priceEditor} data-spend-price-editor={key}>
                      <div className={css.priceFields}>
                        {(['input', 'output', ...priceDraft.more ? ['cacheRead', 'cacheWrite'] as const : []] as const).map(kind => (
                          <label key={kind} className={css.priceField}>
                            <span className={css.fieldHint}>{t(`brains.prices.${kind}`)}</span>
                            <input
                              className={css.budgetInput}
                              inputMode="decimal"
                              aria-label={`${row.model} ${t(`brains.prices.${kind}`)}`}
                              placeholder={kind === 'cacheRead' || kind === 'cacheWrite' ? priceDraft.input : ''}
                              value={priceDraft[kind]}
                              onChange={(event) => { setPriceDraft({ ...priceDraft, [kind]: event.target.value }) }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') { event.preventDefault(); void savePrice() }
                                if (event.key === 'Escape') setPriceDraft(null)
                              }}
                            />
                          </label>
                        ))}
                      </div>
                      <span className={css.fieldHint} data-spend-price-source={row.price?.source ?? 'none'}>
                        {priceHint(row, usage.cost, usage.openRouterPrices)}
                      </span>
                      <span className={css.keyActions}>
                        <button type="button" className={css.secondary} onClick={() => { setPriceDraft({ ...priceDraft, more: !priceDraft.more }) }}>
                          {t(priceDraft.more ? 'brains.prices.less' : 'brains.prices.more')}
                        </button>
                        <button type="button" className={css.secondary} onClick={() => { setPriceDraft(null) }}>{t('brains.cancel')}</button>
                        <button type="button" className={css.primary} onClick={() => { void savePrice() }}>{t('brains.save')}</button>
                      </span>
                    </div>
                  )}
                </Fragment>
              )
            })}
            {(usage.models ?? []).length > 0 && (() => {
              const rows = usage.models ?? []
              const priced = rows.filter(row => row.cost !== undefined)
              const unpriced = rows.filter(row => row.category === 'metered' && row.cost === undefined).length
              const sum = priced.reduce((total, row) => total + (row.cost ?? 0), 0)
              return (
                <div className={css.tableTotal} role="row" data-spend-total="">
                  <span className={css.colCategory}><strong>{t('brains.spend.total')}</strong></span>
                  <span className={css.colPeriod}>{tokens(rows.reduce((total, row) => total + row.total, 0))}</span>
                  <span className={css.colCost}>
                    <strong data-spend-total-cost="">{priced.length === 0 ? '—' : money(sum, usage.cost.currency)}</strong>
                    {unpriced > 0 && <small data-spend-unpriced-count={String(unpriced)}>{t('brains.spend.unpricedCount', { count: unpriced })}</small>}
                  </span>
                </div>
              )
            })()}
          </div>
          <SectionHead title={t('brains.generations.title')} detail={t('brains.generations.detail')} />
          {(() => {
            const generations = usage.generations ?? { rows: [], currency: null }
            const madeTotal = generations.rows.reduce((sum, row) => sum + row.count, 0)
            const billedTotal = generations.rows.reduce((sum, row) => sum + (row.billed?.cost ?? 0), 0)
            return (
              <div className={css.table} role="table" aria-label={t('brains.generations.title')} data-generations="">
                <div className={css.tableHead} role="row">
                  <span className={css.colCategory}>{t('brains.generations.endpoint')}</span>
                  <span className={css.colPeriod}>{t('brains.generations.made')}</span>
                  <span className={css.colCost}>{t('brains.generations.billed')}</span>
                </div>
                {generations.rows.length === 0 && <div className={css.emptyRow}>{t('brains.generations.none')}</div>}
                {generations.rows.map(row => (
                  <div key={`${row.provider} ${row.model}`} className={css.tableRow} role="row" data-generation-row={row.model}>
                    <span className={css.colCategory}>
                      <strong>{row.model}</strong>
                      <small>
                        {row.mediaType === undefined
                          ? providerName(row.provider)
                          : t('brains.generations.of', {
                            provider: providerName(row.provider),
                            kind: t(`brains.generations.kind.${mediaKind(row.mediaType)}`),
                          })}
                      </small>
                    </span>
                    <span className={css.colPeriod}>{String(row.count)}</span>
                    <span className={css.colCost}>
                      {row.billed === undefined
                        ? <small data-generation-unbilled={row.model}>{t('brains.generations.unbilled')}</small>
                        : (
                          <>
                            <strong data-generation-cost={row.model}>{money(row.billed.cost, row.billed.currency)}</strong>
                            <small>{t('brains.generations.units', { quantity: row.billed.quantity, unit: row.billed.unit })}</small>
                          </>
                        )}
                    </span>
                  </div>
                ))}
                {generations.rows.length > 0 && (
                  <div className={css.tableTotal} role="row" data-generations-total="">
                    <span className={css.colCategory}><strong>{t('brains.spend.total')}</strong></span>
                    <span className={css.colPeriod}>{String(madeTotal)}</span>
                    <span className={css.colCost}>
                      <strong data-generations-total-cost="">
                        {generations.currency === null ? '—' : money(billedTotal, generations.currency)}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            )
          })()}
          {usage.falUsage == null && <p className={css.note} data-generations-connect="">{t('brains.generations.connect')}</p>}
          {usage.falUsage?.error !== undefined && (
            <p className={css.note} data-generations-error="">{t('brains.generations.failed', { error: usage.falUsage.error })}</p>
          )}
        </>
      )}
      <div className={css.budgetRow}>
        <span className={css.fieldLabel}>{t('brains.budget.monthly')}</span>
        {budgetDraft === null
          ? (
            <button type="button" className={css.budgetValue} onClick={() => { setBudgetDraft(String(usage?.monthlyTokenBudget ?? 0)) }}>
              {usage === null || usage.monthlyTokenBudget === 0
                ? t('brains.budget.unset')
                : `${tokens(usage.month.total)} / ${tokens(usage.monthlyTokenBudget)}`}
            </button>
          )
          : (
            <span className={css.budgetEdit}>
              <input
                className={css.budgetInput}
                inputMode="numeric"
                aria-label={t('brains.budget.monthly')}
                value={budgetDraft}
                onChange={(event) => { setBudgetDraft(event.target.value) }}
              />
              <button type="button" className={css.primary} onClick={() => { void saveBudget() }}>{t('brains.save')}</button>
              <button type="button" className={css.secondary} onClick={() => { setBudgetDraft(null) }}>{t('brains.cancel')}</button>
            </span>
          )}
      </div>
      {usage !== null && usage.monthlyTokenBudget > 0 && (
        <div className={css.track} aria-hidden="true">
          <div className={css.fill} style={{ width: `${String(Math.min(100, Math.round(usage.month.total / usage.monthlyTokenBudget * 100)))}%` }} />
        </div>
      )}
      <p className={css.note}>{t('brains.budget.note')}</p>
      {status !== '' && <p className={css.status} role="status">{status}</p>}
    </>
  )
}
