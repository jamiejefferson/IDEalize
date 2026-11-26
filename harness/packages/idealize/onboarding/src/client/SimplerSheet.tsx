/**
 * The welcome sheet for someone who updates into the three-view app: one
 * sheet, shown once, saying what changed and asking only for what the person
 * lacks. Coding reads Ready when the Terminal's launch app is installed, Chat
 * and Studio read Ready when an OpenRouter key is connected, and the fal block
 * shows while no fal key is connected. "Save and continue" saves the pasted
 * keys and aligns only a coding app chosen here; either button closes the
 * sheet for good.
 */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { OnboardingApi } from './api.ts'
import type { OnboardingKey } from './locales.ts'
import { notifyBrainsChanged } from './brains-changed.ts'
import { firstInstalled, launchChoiceOf } from './setup-model.ts'
import { CodingAppList, FalBlock, OpenRouterBlock } from './SetupParts.tsx'
import parts from './SetupParts.module.css'
import type { SimplerSheetState } from './simpler.ts'
import { useSetup } from './use-setup.ts'
import overlay from './OnboardingOverlay.module.css'
import css from './SimplerSheet.module.css'

/** Registration-side face. */
export interface SimplerSheetInjected {
  hooks: {
    /** Whether the sheet is on screen. */
    sheet: SnapshotStore<SimplerSheetState>
  }
  /** The host route client. */
  api: OnboardingApi
  /** Close the sheet for good and record it as seen. */
  close: () => void
}

export type SimplerSheetProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'idealize-onboarding'>
  & InjectFace<SimplerSheetInjected>

/** Props for the mounted sheet. */
interface SimplerSheetBodyProps {
  api: OnboardingApi
  t: (key: OnboardingKey) => string
  close: () => void
}

function Status({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className={css.status} data-simpler-status={ready ? 'ready' : 'needs'}>
      {ready && <span aria-hidden="true">✓</span>}
      {label}
    </span>
  )
}

function SimplerSheetBody({ api, t, close }: SimplerSheetBodyProps) {
  const setup = useSetup(api, t)
  const { facts, selected } = setup
  const [fallback, setFallback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.loadChatFallback().then(setFallback, () => {
      // The line is a reassurance: without the read the sheet leaves it out.
    })
    // Mount-only: the sheet reads the host once.
  }, [])

  const current = facts === null ? undefined : launchChoiceOf(facts.launchCommand, facts.catalog)
  const codingReady = current?.installed === true

  // When the launch app is missing, the first installed app starts selected.
  // A launch command no choice accounts for is the person's own, so nothing
  // is selected over it.
  const preselected = useRef(false)
  useEffect(() => {
    if (facts === null || preselected.current) return
    preselected.current = true
    if (codingReady || (current === undefined && facts.launchCommand.trim() !== '')) return
    const first = firstInstalled(facts.rows)
    if (first !== null) setup.select(first)
  }, [facts])

  const save = (): void => {
    setBusy(true)
    // A key added here is added to be used: with no app picked in the sheet,
    // Chat still moves to the company of the app Coding already runs.
    const addingKey = setup.openrouterDraft.trim() !== ''
    const alignCurrent = async (): Promise<boolean> => {
      if (selected !== null || !addingKey || current === undefined) return true
      await api.align(current.id).catch(() => undefined)
      return true
    }
    void (async () => (await setup.saveKeys()) && (await setup.alignSelected()) && (await alignCurrent()))().then((saved) => {
      setBusy(false)
      if (!saved) return
      // A stored key or a new launch app changes what the surfaces under the sheet can offer.
      notifyBrainsChanged()
      close()
    })
  }

  const chosen = facts?.catalog.find(entry => entry.id === selected) ?? current
  const app = chosen?.label ?? facts?.launchCommand.trim().split(' ')[0] ?? ''

  return (
    <div className={css.scrim} data-idealize-simpler role="dialog" aria-modal="true" aria-label={t('simpler.title')}>
      <div className={css.sheet}>
        <h2 className={overlay.title}>{t('simpler.title')}</h2>
        <p className={overlay.sub}>{t('simpler.sub')}</p>
        {facts === null
          ? <p className={parts.reason} data-simpler-loading>{setup.loadFailed ? t('agents.loadError') : t('agents.loading')}</p>
          : (
            <div className={css.rows}>
              <section className={css.row} data-simpler-row="coding">
                <div className={css.rowHead}>
                  <span className={parts.title}>{t('simpler.coding.title')}</span>
                  <Status ready={codingReady} label={codingReady ? t('simpler.ready') : t('simpler.needsSetup')} />
                </div>
                <p className={parts.reason} data-simpler-coding-runs>
                  {app === '' ? t('simpler.coding.pick') : t('simpler.coding.runs').replace('{app}', app)}
                </p>
                {!codingReady && <CodingAppList rows={facts.rows} selected={selected} onSelect={setup.select} t={t} />}
                {setup.alignError !== null && <p className={parts.error} data-setup-error="coding">{setup.alignError}</p>}
              </section>
              <section className={css.row} data-simpler-row="chat">
                <div className={css.rowHead}>
                  <span className={parts.title}>{t('simpler.chat.title')}</span>
                  <Status ready={facts.openrouter} label={facts.openrouter ? t('simpler.ready') : t('simpler.needsKey')} />
                </div>
                {facts.openrouter
                  ? <p className={parts.reason} data-simpler-chat-runs>{t('simpler.chat.runs')}</p>
                  : (
                    <>
                      <OpenRouterBlock
                        setup={setup}
                        connected={false}
                        t={t}
                        matching={facts.rows.find(row => row.id === selected)?.company}
                      />
                      {fallback !== null && (
                        <p className={parts.reason} data-simpler-fallback>
                          {t('simpler.chat.fallback').replace('{provider}', fallback)}
                        </p>
                      )}
                    </>
                  )}
              </section>
              {!facts.fal && (
                <section className={css.row} data-simpler-row="fal">
                  <FalBlock setup={setup} connected={false} t={t} modelCount={facts.falModelCount} />
                </section>
              )}
            </div>
          )}
        <div className={css.foot}>
          <button type="button" className={overlay.back} disabled={busy} onClick={close} data-simpler-later>
            {t('simpler.later')}
          </button>
          <button type="button" className={overlay.primary} disabled={busy} onClick={save} data-simpler-save>
            {busy ? t('nav.busy') : t('simpler.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SimplerSheet(props: SimplerSheetProps) {
  const open = props.useSheet(state => state.open)
  if (!open) return null
  return <SimplerSheetBody api={props.api} t={props.t} close={props.close} />
}
