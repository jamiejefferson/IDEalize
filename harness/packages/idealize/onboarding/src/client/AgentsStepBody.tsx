/**
 * The agents step body: one card per provider the wizard can connect —
 * Claude Code CLI (detected through the host route), OpenRouter (a key
 * field) and a key gateway (an organisation's address and key). Continue waits
 * until at least one provider is connected; connections persist at connect
 * time, so the step itself has nothing to save on Continue.
 */
import { useEffect, useState } from 'react'
import type { OnboardingKey } from './locales.ts'
import type { AgentsState, OnboardingApi } from './api.ts'
import css from './AgentsStepBody.module.css'

/** What every step body receives from the overlay. */
export interface StepBodyProps {
  /** The route client. */
  api: OnboardingApi
  /** The namespace translator. */
  t: (key: OnboardingKey) => string
  /**
   * Report whether the step's Continue may engage; called on mount and on
   * every change. Steps without a gate never call it (the overlay's default
   * is ready).
   */
  onReadyChange: (ready: boolean) => void
  /**
   * Register the step's commit action — called by Continue and answering
   * whether the step may complete. Steps with nothing to save on Continue
   * register nothing.
   */
  registerCommit: (commit: (() => Promise<boolean>) | null) => void
}


export function AgentsStepBody({ api, t, onReadyChange, registerCommit }: StepBodyProps) {
  const [state, setState] = useState<AgentsState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [gateway, setGateway] = useState(false)
  const [gatewayDraft, setGatewayDraft] = useState({ address: '', key: '' })
  const [gatewayError, setGatewayError] = useState<string | null>(null)

  const refresh = (): void => {
    api.loadAgents().then(setState, () => { setLoadFailed(true) })
    api.loadGateway().then(setGateway, () => { setGateway(false) })
  }
  useEffect(() => {
    registerCommit(null)
    refresh()
    // Mount-only: the step re-polls the host on every entry.
  }, [])

  const connected = state !== null && (state.claudeCode.installed || state.openrouter.connected || gateway)
  useEffect(() => { onReadyChange(connected) }, [connected, onReadyChange])

  const connect = (): void => {
    setBusy(true)
    setSaveError(null)
    api.connectOpenRouter(key.trim()).then((outcome) => {
      setBusy(false)
      if (!outcome.ok) {
        setSaveError(outcome.error)
        return
      }
      setKey('')
      refresh()
    }, () => {
      setBusy(false)
      setSaveError(t('agents.openrouter.unreachable'))
    })
  }

  const connectGateway = (): void => {
    setBusy(true)
    setGatewayError(null)
    api.connectGateway(gatewayDraft.address.trim(), gatewayDraft.key.trim()).then((outcome) => {
      setBusy(false)
      if (!outcome.ok) {
        setGatewayError(outcome.error)
        return
      }
      setGatewayDraft({ address: '', key: '' })
      refresh()
    }, () => {
      setBusy(false)
      setGatewayError(t('agents.gateway.unreachable'))
    })
  }

  if (state === null) {
    return <p className={css.note}>{loadFailed ? t('agents.loadError') : t('agents.loading')}</p>
  }
  const showKeyEditor = !state.openrouter.connected

  return (
    <div className={css.cards} data-agents-step>
      <div className={css.card} data-agent-card="claude-code">
        <span className={css.glyph} data-connected={state.claudeCode.installed ? '' : undefined}>
          {state.claudeCode.installed ? '✓' : '○'}
        </span>
        <div className={css.cardBody}>
          <span className={css.cardTitle}>{t('agents.claude.title')}</span>
          <span className={css.cardSub}>{t('agents.claude.sub')}</span>
          {state.claudeCode.installed
            ? <code className={css.path} data-agent-path>{state.claudeCode.path}</code>
            : <span className={css.cardHint}>{t('agents.claude.missing')}</span>}
        </div>
        {!state.claudeCode.installed && (
          <button type="button" className={css.secondary} onClick={refresh} data-agent-recheck>
            {t('agents.claude.recheck')}
          </button>
        )}
      </div>
      <div className={css.card} data-agent-card="openrouter">
        <span className={css.glyph} data-connected={state.openrouter.connected ? '' : undefined}>
          {state.openrouter.connected ? '✓' : '○'}
        </span>
        <div className={css.cardBody}>
          <span className={css.cardTitle}>{t('agents.openrouter.title')}</span>
          <span className={css.cardSub}>{t('agents.openrouter.sub')}</span>
          <span className={css.cardHint} data-agent-reads="">{t('agents.openrouter.reads')}</span>
          {state.openrouter.connected && <span className={css.cardHint}>{t('agents.openrouter.connected')}</span>}
          {showKeyEditor && (
            <input
              className={css.input}
              type="password"
              placeholder={t('agents.openrouter.placeholder')}
              value={key}
              onChange={(event) => { setKey(event.target.value) }}
              data-agent-key
            />
          )}
          {saveError !== null && <p className={css.error} data-agent-error>{saveError}</p>}
        </div>
        {showKeyEditor && (
          <button
            type="button"
            className={css.secondary}
            disabled={busy || key.trim() === ''}
            onClick={connect}
            data-agent-connect
          >
            {busy
              ? t('nav.busy')
              : state.openrouter.connected
                ? t('agents.openrouter.replace')
                : t('agents.openrouter.connect')}
          </button>
        )}
      </div>
      <div className={css.card} data-agent-card="gateway">
        <span className={css.glyph} data-connected={gateway ? '' : undefined}>
          {gateway ? '✓' : '○'}
        </span>
        <div className={css.cardBody}>
          <span className={css.cardTitle}>{t('agents.gateway.title')}</span>
          <span className={css.cardSub}>{t('agents.gateway.sub')}</span>
          {gateway && <span className={css.cardHint}>{t('agents.openrouter.connected')}</span>}
          {!gateway && (
            <>
              <input
                className={css.input}
                type="url"
                placeholder={t('agents.gateway.address')}
                aria-label={t('agents.gateway.address')}
                value={gatewayDraft.address}
                onChange={(event) => { setGatewayDraft({ ...gatewayDraft, address: event.target.value }) }}
                data-gateway-address
              />
              <input
                className={css.input}
                type="password"
                placeholder={t('agents.gateway.key')}
                aria-label={t('agents.gateway.key')}
                value={gatewayDraft.key}
                onChange={(event) => { setGatewayDraft({ ...gatewayDraft, key: event.target.value }) }}
                data-gateway-key
              />
            </>
          )}
          {gatewayError !== null && <p className={css.error} data-gateway-error>{gatewayError}</p>}
        </div>
        {!gateway && (
          <button
            type="button"
            className={css.secondary}
            disabled={busy || gatewayDraft.address.trim() === '' || gatewayDraft.key.trim() === ''}
            onClick={connectGateway}
            data-gateway-connect
          >
            {busy ? t('nav.busy') : t('agents.openrouter.connect')}
          </button>
        )}
      </div>
      {!connected && <p className={css.note}>{t('agents.hint')}</p>}
    </div>
  )
}
