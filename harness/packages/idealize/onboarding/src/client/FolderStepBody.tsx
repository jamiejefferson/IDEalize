/**
 * A folder step body (projects root or documentation vault): the Host
 * directory picker or a typed path, with a live probe through the setup alias
 * route — the verdict renders verbatim and Continue engages only on a
 * successful probe of the current path. An existing `idealize-setup` alias
 * pre-fills the field, so a returning user confirms in one tap.
 */
import { useEffect, useRef, useState } from 'react'
import type { StepBodyProps } from './AgentsStepBody.tsx'
import css from './FolderStepBody.module.css'

/** Props for {@link FolderStepBody}. */
export interface FolderStepBodyProps extends StepBodyProps {
  /** Which alias this step captures. */
  alias: 'projectsRoot' | 'documentation' | 'skills'
  /** The current path (the overlay holds every folder so the finish step can read them). */
  value: string
  /** Update the path. */
  onChange: (path: string) => void
  /** The pre-fill source: the `idealize-setup` aliases, when they stand. */
  readSetupAliases: () => { projectsRoot?: string; documentation?: string; skills?: string }
  /** Open the Host directory picker; null when cancelled or unavailable. */
  pickDirectory: () => Promise<string | null>
}

/** The probe's verdict for one path value. */
interface ProbeVerdict {
  /** The probed path (a verdict applies only while the field still holds it). */
  path: string
  state: 'probing' | 'ok' | 'failed'
  /** The host's plain-language refusal, present on `failed`. */
  reason?: string
}

export function FolderStepBody(props: FolderStepBodyProps) {
  const { api, t, onReadyChange, registerCommit, alias, value, onChange, readSetupAliases, pickDirectory } = props
  const [manual, setManual] = useState(false)
  const [probe, setProbe] = useState<ProbeVerdict | null>(null)
  const probeToken = useRef(0)

  useEffect(() => {
    registerCommit(null)
    if (value === '') {
      const existing = readSetupAliases()[alias]
      if (existing !== undefined && existing !== '') onChange(existing)
    }
    // Mount-only pre-fill from the existing setup aliases.
  }, [])

  useEffect(() => {
    if (value === '') {
      setProbe(null)
      return
    }
    const token = ++probeToken.current
    const timer = setTimeout(() => {
      setProbe({ path: value, state: 'probing' })
      api.probeFolder(alias, value).then((outcome) => {
        if (probeToken.current !== token) return
        setProbe(outcome.ok
          ? { path: value, state: 'ok' }
          : { path: value, state: 'failed', reason: outcome.error })
      }, () => {
        if (probeToken.current !== token) return
        setProbe({ path: value, state: 'failed', reason: t('folder.probeError') })
      })
    }, 250)
    return () => { clearTimeout(timer) }
    // The probe re-runs when the path changes; the api/t identities are stable.
  }, [value, alias])

  const ready = value !== '' && probe?.state === 'ok' && probe.path === value
  useEffect(() => { onReadyChange(ready) }, [ready, onReadyChange])

  const choose = (): void => {
    pickDirectory().then((path) => {
      if (path !== null) onChange(path)
    }).catch(() => {
      // No Host picker on this shell (a remote browser): the row's
      // type-a-path input remains the way in.
    })
  }

  return (
    <div className={css.body} data-folder-step={alias}>
      <div className={css.pathLine}>
        <span className={`${css.path} ${value === '' ? css.pathEmpty : ''}`} data-folder-value>
          {value === '' ? t('folder.notChosen') : value}
        </span>
        <button type="button" className={css.secondary} onClick={choose} data-folder-choose>
          {t('folder.choose')}
        </button>
      </div>
      {manual
        ? (
          <input
            className={css.input}
            placeholder={t('folder.manualPlaceholder')}
            value={value}
            onChange={(event) => { onChange(event.target.value) }}
            data-folder-input
          />
        )
        : (
          <button type="button" className={css.manualToggle} onClick={() => { setManual(true) }} data-folder-manual>
            {t('folder.manual')}
          </button>
        )}
      {probe?.state === 'probing' && probe.path === value && (
        <p className={css.hint} data-folder-probing>{t('folder.probing')}</p>
      )}
      {probe?.state === 'failed' && probe.path === value && (
        <p className={css.error} data-folder-error>{probe.reason}</p>
      )}
    </div>
  )
}
