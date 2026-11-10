/**
 * The Brains row for a key gateway: one key from the person's organisation
 * that reaches every model service it pays for. It asks for the gateway's
 * address and the key, checks them with the gateway before storing them, and
 * then shows what the key reaches and this month's spend. The address is the
 * person's own; the app names no gateway.
 * @module @idealize/ui-bar/client/GatewayRow
 */
import { useCallback, useEffect, useState } from 'react'
import { BRAINS_CHANGED_EVENT, notifyBrainsChanged } from './brains-changed.ts'
import type { BarKey } from './locales.ts'
import css from './BrainsPanel.module.css'

type Translate = (key: BarKey, params?: Record<string, string | number>) => string

/** GET /idealize/brains/gateway, as far as this row reads it. */
export interface GatewayState {
  configured: boolean
  address?: string
  connected: boolean
  preset?: string
  budgetGbp?: number | null
  spentGbp?: number
  services: string[]
  error?: string
}

const PATH = '/idealize/brains/gateway'
const HEADERS = { 'x-idealize-auth': '1', 'content-type': 'application/json' }

/** Read the gateway's state; null when the host serves no gateway. */
export async function readGateway(fetchImpl: typeof fetch = fetch): Promise<GatewayState | null> {
  try {
    const response = await fetchImpl(PATH)
    return response.ok ? await response.json() as GatewayState : null
  } catch {
    return null
  }
}

/** The line under the row's name. */
export function gatewayLine(state: GatewayState, t: Translate): string {
  if (!state.configured) return t('brains.gateway.blurb')
  if (!state.connected) return state.error ?? t('brains.gateway.notConnected')
  const parts: string[] = []
  if (state.preset !== undefined) parts.push(state.preset)
  if (state.services.length > 0) parts.push(t('brains.gateway.reaches', { services: state.services.join(', ') }))
  if (typeof state.spentGbp === 'number') {
    const spent = state.spentGbp.toFixed(2)
    parts.push(typeof state.budgetGbp === 'number'
      ? t('brains.gateway.spentOf', { spent, budget: state.budgetGbp.toFixed(2) })
      : t('brains.gateway.spent', { spent }))
  }
  return parts.join(' · ')
}

/**
 * The row. Shown under the connected services once a gateway is set, and at
 * the top of the full services list until then.
 * @param props - copy, whether to show only a configured gateway, and a test fetch.
 * @returns the row, or nothing when it has no place in this list.
 */
export function GatewayRow({ t, configuredOnly, onState, fetchImpl = fetch }: {
  t: Translate
  configuredOnly: boolean
  /** Told whether a gateway is set, so the list can drop its empty-state line. */
  onState?: (configured: boolean) => void
  fetchImpl?: typeof fetch
}) {
  const [state, setState] = useState<GatewayState | null>(null)
  const [draft, setDraft] = useState<{ address: string; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => { setState(await readGateway(fetchImpl)) }, [fetchImpl])
  useEffect(() => {
    void load()
    // The row in the other list hears a connect or a removal and follows it.
    const reload = (): void => { void load() }
    document.addEventListener(BRAINS_CHANGED_EVENT, reload)
    return () => { document.removeEventListener(BRAINS_CHANGED_EVENT, reload) }
  }, [load])
  useEffect(() => { if (state !== null) onState?.(state.configured) }, [state, onState])

  if (state === null) return null
  if (configuredOnly !== state.configured) return null

  const send = async (method: 'POST' | 'DELETE', body?: unknown): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetchImpl(PATH, { method, headers: HEADERS, ...body === undefined ? {} : { body: JSON.stringify(body) } })
      const parsed = await response.json().catch(() => null) as (GatewayState & { error?: string }) | null
      if (!response.ok) {
        setError(parsed?.error ?? t('brains.gateway.failed'))
        return
      }
      setDraft(null)
      if (parsed !== null) setState(parsed)
      notifyBrainsChanged()
    } catch {
      setError(t('brains.gateway.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={css.providerRow} data-gateway="" data-gateway-connected={state.connected ? '' : undefined}>
      <span className={css.providerName}>
        <strong>{t('brains.gateway.name')}</strong>
        <small data-gateway-line="">{gatewayLine(state, t)}</small>
      </span>
      {draft !== null
        ? (
          <span className={css.keyPanel}>
            <span className={css.keyRow}>
              <input
                className={css.budgetInput}
                type="url"
                autoComplete="off"
                autoFocus
                aria-label={t('brains.gateway.address')}
                placeholder={t('brains.gateway.address')}
                value={draft.address}
                data-gateway-address=""
                onChange={(event) => { setDraft({ ...draft, address: event.target.value }) }}
              />
            </span>
            <span className={css.keyRow}>
              <input
                className={css.budgetInput}
                type="password"
                autoComplete="off"
                aria-label={t('brains.gateway.key')}
                placeholder={t('brains.gateway.key')}
                value={draft.key}
                data-gateway-key=""
                onChange={(event) => { setDraft({ ...draft, key: event.target.value }) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void send('POST', draft)
                  if (event.key === 'Escape') setDraft(null)
                }}
              />
              <span className={css.keyActions}>
                <button type="button" className={css.secondary} onClick={() => { setDraft(null); setError(null) }}>{t('brains.cancel')}</button>
                <button type="button" className={css.primary} disabled={busy} data-gateway-connect="" onClick={() => { void send('POST', draft) }}>
                  {t('brains.gateway.connect')}
                </button>
              </span>
            </span>
            {error !== null && <span className={css.keyError} role="alert" data-gateway-error="">{error}</span>}
          </span>
        )
        : (
          <>
            {state.configured && (
              <span className={css.badge} data-gateway-badge="">{t(state.connected ? 'brains.gateway.connected' : 'brains.gateway.notConnected')}</span>
            )}
            <button
              type="button"
              className={css.rowLink}
              data-gateway-open=""
              onClick={() => { setDraft({ address: state.address ?? '', key: '' }) }}
            >
              {t(state.configured ? 'brains.gateway.change' : 'brains.gateway.connect')}
            </button>
            {state.configured && (
              <button type="button" className={css.rowLink} data-gateway-remove="" disabled={busy} onClick={() => { void send('DELETE') }}>
                {t('brains.gateway.remove')}
              </button>
            )}
          </>
        )}
    </div>
  )
}
