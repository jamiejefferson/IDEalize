/**
 * The set-up step body ("Set up your models"): three numbered parts, each
 * saying what it unlocks. Part 1 picks the coding subscription from the apps
 * the Terminal can launch, part 2 takes an OpenRouter key, part 3 an optional
 * fal key. A company key gateway stays reachable behind a text link.
 *
 * Continue engages once a coding app is selected, an OpenRouter key is
 * connected or pasted, or a gateway is connected. It saves the pasted keys
 * and then aligns the Terminal and the default chat model with the selected
 * app; a refusal shows in place and the step stays. "Skip keys for now" saves
 * no key and still aligns the selected app.
 */
import { useEffect, useRef, useState } from 'react'
import type { OnboardingKey } from './locales.ts'
import type { OnboardingApi } from './api.ts'
import { firstInstalled } from './setup-model.ts'
import { CodingAppList, FalBlock, OpenRouterBlock } from './SetupParts.tsx'
import parts from './SetupParts.module.css'
import { useSetup } from './use-setup.ts'
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

/** Props for {@link AgentsStepBody}. */
export interface AgentsStepBodyProps extends StepBodyProps {
  /** Register what the step's skip action does before the overlay records the skip. */
  registerSkip: (skip: (() => Promise<void>) | null) => void
}

export function AgentsStepBody({ api, t, onReadyChange, registerCommit, registerSkip }: AgentsStepBodyProps) {
  const setup = useSetup(api, t)
  const { facts, selected } = setup
  const [busy, setBusy] = useState(false)
  const [gatewayOpen, setGatewayOpen] = useState(false)
  const [gatewayDraft, setGatewayDraft] = useState({ address: '', key: '' })
  const [gatewayError, setGatewayError] = useState<string | null>(null)

  // The first installed app starts selected, once, when the host's report lands.
  const preselected = useRef(false)
  useEffect(() => {
    if (facts === null || preselected.current) return
    preselected.current = true
    const first = firstInstalled(facts.rows)
    if (first !== null) setup.select(first)
  }, [facts])

  const ready = facts !== null
    && (selected !== null || facts.openrouter || facts.gateway || setup.openrouterDraft.trim() !== '')
  useEffect(() => { onReadyChange(ready) }, [ready, onReadyChange])

  useEffect(() => {
    registerCommit(async () => (await setup.saveKeys()) && (await setup.alignSelected()))
    // A skip never waits on a refusal: the launch command keeps its last value.
    registerSkip(async () => { await setup.alignSelected() })
    return () => {
      registerCommit(null)
      registerSkip(null)
    }
    // The actions read the latest choices through the registered closures.
  }, [selected, setup.openrouterDraft, setup.falDraft])

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
      setup.refresh()
    }, () => {
      setBusy(false)
      setGatewayError(t('setup.gateway.unreachable'))
    })
  }

  if (facts === null) {
    return <p className={css.note}>{setup.loadFailed ? t('agents.loadError') : t('agents.loading')}</p>
  }
  const matching = facts.rows.find(row => row.id === selected)?.company

  return (
    <div className={css.parts} data-agents-step>
      <section className={css.part} data-setup-part="coding">
        <span className={css.number} aria-hidden="true">1</span>
        <div className={css.partBody}>
          <span className={parts.title}>{t('setup.coding.title')}</span>
          <p className={parts.reason} data-setup-reason="coding">{t('setup.coding.reason')}</p>
          <CodingAppList rows={facts.rows} selected={selected} onSelect={setup.select} t={t} />
          {setup.alignError !== null && <p className={parts.error} data-setup-error="coding">{setup.alignError}</p>}
        </div>
      </section>
      <section className={css.part} data-setup-part="openrouter">
        <span className={css.number} aria-hidden="true">2</span>
        <div className={css.partBody}>
          <OpenRouterBlock setup={setup} connected={facts.openrouter} t={t} matching={matching} />
        </div>
      </section>
      <section className={css.part} data-setup-part="fal">
        <span className={css.number} aria-hidden="true">3</span>
        <div className={css.partBody}>
          <FalBlock setup={setup} connected={facts.fal} t={t} modelCount={facts.falModelCount} />
        </div>
      </section>
      <div className={css.gateway} data-setup-gateway data-connected={facts.gateway ? '' : undefined}>
        {facts.gateway
          ? (
            <span className={parts.connected} data-setup-connected="gateway">
              <span aria-hidden="true">✓</span>
              {t('setup.gateway.link')}
            </span>
          )
          : (
            <button type="button" className={parts.link} onClick={() => { setGatewayOpen(open => !open) }} data-setup-gateway-link>
              {t('setup.gateway.link')}
            </button>
          )}
        {gatewayOpen && !facts.gateway && (
          <div className={css.gatewayFields}>
            <p className={parts.reason}>{t('setup.gateway.sub')}</p>
            <input
              className={parts.input}
              type="url"
              placeholder={t('setup.gateway.address')}
              aria-label={t('setup.gateway.address')}
              value={gatewayDraft.address}
              onChange={(event) => { setGatewayDraft({ ...gatewayDraft, address: event.target.value }) }}
              data-gateway-address
            />
            <input
              className={parts.input}
              type="password"
              placeholder={t('setup.gateway.key')}
              aria-label={t('setup.gateway.key')}
              value={gatewayDraft.key}
              onChange={(event) => { setGatewayDraft({ ...gatewayDraft, key: event.target.value }) }}
              data-gateway-key
            />
            <button
              type="button"
              className={css.secondary}
              disabled={busy || gatewayDraft.address.trim() === '' || gatewayDraft.key.trim() === ''}
              onClick={connectGateway}
              data-gateway-connect
            >
              {busy ? t('nav.busy') : t('setup.gateway.connect')}
            </button>
            {gatewayError !== null && <p className={parts.error} data-gateway-error>{gatewayError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
