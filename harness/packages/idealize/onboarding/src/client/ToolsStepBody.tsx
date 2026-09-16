/**
 * The tools step body: one choice per row, grouped by space. Chat asks a model
 * for Design, Coding, Writing, Admin and Free (Free is a tick when the
 * free-tokens route carries it, and a choice like the others when no such
 * route exists); Terminal asks only which CLI a fresh shell types, because a
 * Terminal brain runs through that CLI and the CLI carries its own model (JJ,
 * 14 Sep 2026: "terminal relies on cli so should be separate"); Gallery, Sound
 * Stage and Motion carry one generation-model row each. The pickers list only
 * routes that can answer now, and the CLI picker only commands the login shell
 * finds. An unavailable generating space shows the localised sentence for the
 * host's live verdict, and a missing compatible model can return directly to
 * the Agents step to add an OpenRouter key. Drafts survive that recovery trip.
 * Only rows the user changed are saved on Continue; a failed save is named
 * against its row and blocks completion.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { StepBodyProps } from './AgentsStepBody.tsx'
import type { ActivityRowState, MediaRowState, TerminalCliOption, TerminalLaunchState, ToolsState } from './api.ts'
import type { OnboardingKey } from './locales.ts'
import css from './ToolsStepBody.module.css'

/** Row label copy keys, keyed by row id. */
const ROW_LABEL: Record<string, OnboardingKey> = {
  design: 'tools.design',
  coding: 'tools.coding',
  writing: 'tools.writing',
  admin: 'tools.admin',
  images: 'tools.images',
  sound: 'tools.sound',
  motion: 'tools.motion',
  free: 'tools.free',
}

/** A generating space's group id and label. */
interface MediaSpace {
  id: string
  label: OnboardingKey
}

/** The Motion group, also the fallback for a media preset outside the wizard's fixed subset. */
const MOTION_SPACE: MediaSpace = { id: 'motion', label: 'tools.space.motion' }

/** The generating spaces' group ids and labels, keyed by their media preset id. */
const MEDIA_SPACE: Record<string, MediaSpace> = {
  images: { id: 'gallery', label: 'tools.space.gallery' },
  sound: { id: 'soundstage', label: 'tools.space.soundstage' },
  motion: MOTION_SPACE,
}

/** Localised recovery copy for the media rows in this fixed subset. */
const MEDIA_COMPATIBILITY_KEY: Record<string, OnboardingKey | undefined> = {
  images: 'tools.recovery.image',
  sound: 'tools.recovery.sound',
  motion: 'tools.recovery.video',
}

/** The Terminal row's draft key; its values are `cli:<catalogue id>`, never a packed model. */
const CLI_ROW_ID = 'cli'

/** A CLI select value from its catalogue id. */
function cliValue(id: string): string {
  return `cli:${id}`
}

/** Resolve the host verdict to shared user-facing copy, retaining its fallback. */
function recoveryText(row: MediaRowState, t: StepBodyProps['t']): string {
  if (row.availability.state === 'available') return ''
  if (row.availability.reason === 'no-backend') return t('tools.recovery.noBackend')
  const key = MEDIA_COMPATIBILITY_KEY[row.id]
  return key === undefined ? row.availability.recovery : t(key)
}

/** Tools-step additions to the callbacks every step body receives. */
interface ToolsStepBodyProps extends StepBodyProps {
  /** Return to the Agents step, whose OpenRouter card stores the missing key. */
  onAddOpenRouterKey: () => void
  /** Choices retained by the overlay while this body visits another step. */
  drafts: Record<string, string>
  /** Retain changed choices outside this body's mount lifetime. */
  onDraftsChange: (drafts: Record<string, string>) => void
}

/** A select option's value: the provider/backend and model id, packed. */
function pack(owner: string, model: string): string {
  return JSON.stringify([owner, model])
}

/** Alphabetical, case-blind, digit runs by value: the order every model picker lists in (JJ, 7 Sep 2026). */
function byName(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/** The stored choice as a select value, or empty for "keep the default". */
function storedValue(row: ActivityRowState | MediaRowState): string {
  if ('overridden' in row) {
    // An activity row pre-selects only a stored override; the resolved default
    // stays "keep the default" so an untouched row is not saved on Continue.
    return row.overridden && row.model !== null ? pack(row.model.provider, row.model.model) : ''
  }
  return row.model === null ? '' : pack(row.model.backend, row.model.model)
}

export function ToolsStepBody({
  api,
  t,
  registerCommit,
  onAddOpenRouterKey,
  drafts,
  onDraftsChange,
}: ToolsStepBodyProps) {
  const [state, setState] = useState<ToolsState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const stateRef = useRef<ToolsState | null>(null)
  const draftsRef = useRef<Record<string, string>>(drafts)
  draftsRef.current = drafts

  const choose = (id: string, value: string): void => {
    draftsRef.current = { ...draftsRef.current, [id]: value }
    onDraftsChange(draftsRef.current)
    setErrors(current => ({ ...current, [id]: '' }))
  }

  useEffect(() => {
    // The commit reads refs so the registered closure never goes stale.
    registerCommit(async () => {
      const tools = stateRef.current
      if (tools === null) return true
      const failures: Record<string, string> = {}
      for (const row of tools.activities) {
        const encoded = draftsRef.current[row.id]
        if (encoded === undefined || encoded === '') continue
        const [provider, model] = JSON.parse(encoded) as [string, string]
        const outcome = await api.saveActivityModel(row, { provider, model })
        if (!outcome.ok) failures[row.id] = outcome.error
      }
      for (const row of tools.media) {
        const encoded = draftsRef.current[row.id]
        if (encoded === undefined || encoded === '') continue
        const [backend, model] = JSON.parse(encoded) as [string, string]
        const outcome = await api.saveMediaModel(row.id, { backend, model })
        if (!outcome.ok) failures[row.id] = outcome.error
      }
      const cliDraft = draftsRef.current[CLI_ROW_ID]
      if (tools.terminal !== null && cliDraft !== undefined && cliDraft !== '') {
        const entry = (tools.terminal.catalog ?? []).find(option => cliValue(option.id) === cliDraft)
        if (entry !== undefined && entry.command !== tools.terminal.default) {
          const outcome = await api.saveTerminalDefault(entry.command)
          if (!outcome.ok) failures[CLI_ROW_ID] = outcome.error
        }
      }
      setErrors(failures)
      return Object.keys(failures).length === 0
    })
    api.loadTools().then((tools) => {
      stateRef.current = tools
      setState(tools)
    }, () => { setLoadFailed(true) })
    return () => { registerCommit(null) }
    // Mount-only: the step reloads on every entry.
  }, [])

  if (state === null) {
    return <p className={css.note}>{loadFailed ? t('tools.loadError') : t('tools.loading')}</p>
  }

  const llmRow = (row: ActivityRowState): ReactNode => (
    <div className={css.row} key={row.id} data-tools-row={row.id}>
      <label className={css.label} htmlFor={`onboarding-tools-${row.id}`}>
        {t(ROW_LABEL[row.id] ?? 'tools.coding')}
      </label>
      <select
        id={`onboarding-tools-${row.id}`}
        className={css.select}
        value={drafts[row.id] ?? storedValue(row)}
        onChange={(event) => { choose(row.id, event.target.value) }}
        data-tools-select
      >
        <option value="">{t('tools.pick')}</option>
        {[...state.providers].sort((left, right) => byName(left.displayName, right.displayName)).map(provider => (
          <optgroup key={provider.provider} label={provider.displayName}>
            {[...provider.models].sort(byName).map(model => (
              <option key={model} value={pack(provider.provider, model)}>{model}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {errors[row.id] !== undefined && errors[row.id] !== '' && <p className={css.error} data-tools-error>{errors[row.id]}</p>}
    </div>
  )

  const mediaRow = (row: MediaRowState): ReactNode => (
    <div className={css.row} key={row.id} data-tools-row={row.id}>
      {row.availability.state === 'available'
        ? (
          <label className={css.label} htmlFor={`onboarding-tools-${row.id}`}>
            {t(ROW_LABEL[row.id] ?? 'tools.images')}
          </label>
        )
        : <span className={css.label}>{t(ROW_LABEL[row.id] ?? 'tools.images')}</span>}
      {row.availability.state === 'unavailable'
        ? (
          <>
            <span className={css.hint} data-tools-unavailable={row.availability.reason}>
              {recoveryText(row, t)}
            </span>
            {/* The key action renders only when a key would change the verdict,
                as the Brains pane gates it — otherwise it promises a recovery
                the route says cannot happen. */}
            {row.availability.reason === 'no-compatible-model' && row.availability.keyMissing === true && (
              <button type="button" className={css.recoveryAction} onClick={onAddOpenRouterKey} data-tools-add-key>
                {t('tools.addKey')}
              </button>
            )}
          </>
        )
        : (
          <select
            id={`onboarding-tools-${row.id}`}
            className={css.select}
            value={drafts[row.id] ?? storedValue(row)}
            onChange={(event) => { choose(row.id, event.target.value) }}
            data-tools-select
          >
            <option value="">{t('tools.pick')}</option>
            {[...row.candidates].sort((left, right) => byName(left.model.name, right.model.name)).map(candidate => (
              <option key={pack(candidate.backend, candidate.model.id)} value={pack(candidate.backend, candidate.model.id)}>
                {candidate.model.name}
              </option>
            ))}
          </select>
        )}
      {errors[row.id] !== undefined && errors[row.id] !== '' && <p className={css.error} data-tools-error>{errors[row.id]}</p>}
    </div>
  )

  /**
   * The Terminal row: the CLI every brain without its own choice launches, as
   * the Brains pane's closing Terminal row asks it. Only CLIs the login shell
   * finds are offered; a command outside the catalogue (set in settings by
   * hand) shows as its own option so the selection is never misread.
   */
  const cliRow = (terminal: TerminalLaunchState): ReactNode => {
    const matched = (terminal.catalog ?? []).find(entry => entry.command === terminal.default)
    const catalog = (terminal.catalog ?? []).filter(entry => entry.installed !== false || entry.id === matched?.id)
    const optionLabel = (entry: TerminalCliOption): string => {
      if (entry.command === '') return t('tools.cli.plainShell')
      return entry.installed === false ? t('tools.cli.notFound').replace('{label}', entry.label) : entry.label
    }
    return (
      <div className={css.row} data-tools-row={CLI_ROW_ID}>
        <label className={css.label} htmlFor={`onboarding-tools-${CLI_ROW_ID}`}>{t('tools.cli')}</label>
        <select
          id={`onboarding-tools-${CLI_ROW_ID}`}
          className={css.select}
          value={drafts[CLI_ROW_ID] ?? (matched === undefined ? 'custom' : cliValue(matched.id))}
          onChange={(event) => { choose(CLI_ROW_ID, event.target.value) }}
          data-tools-select
        >
          {matched === undefined && (
            <option value="custom">{t('tools.cli.custom').replace('{command}', terminal.default === '' ? '—' : terminal.default)}</option>
          )}
          {catalog.map(entry => (
            <option key={entry.id} value={cliValue(entry.id)}>{optionLabel(entry)}</option>
          ))}
        </select>
        {errors[CLI_ROW_ID] !== undefined && errors[CLI_ROW_ID] !== '' && <p className={css.error} data-tools-error>{errors[CLI_ROW_ID]}</p>}
      </div>
    )
  }

  return (
    <div className={css.rows} data-tools-step>
      <section className={css.group} data-tools-space="chat">
        <h3 className={css.groupTitle} data-tools-space-title>{t('tools.space.chat')}</h3>
        <div className={css.groupRows}>
          {state.activities.map(llmRow)}
          {state.freeRoute && (
            <div className={css.row} data-tools-row="free">
              <span className={css.tick}>✓</span>
              <span className={css.label}>{t('tools.free')}</span>
              <span className={css.hint}>{t('tools.free.note')}</span>
            </div>
          )}
        </div>
      </section>
      {state.terminal !== null && (
        <section className={css.group} data-tools-space="terminal">
          <h3 className={css.groupTitle} data-tools-space-title>{t('tools.space.terminal')}</h3>
          <div className={css.groupRows}>{cliRow(state.terminal)}</div>
        </section>
      )}
      {state.media.map((row) => {
        const space = MEDIA_SPACE[row.id] ?? MOTION_SPACE
        return (
          <section className={css.group} data-tools-space={space.id} key={row.id}>
            <h3 className={css.groupTitle} data-tools-space-title>{t(space.label)}</h3>
            <div className={css.groupRows}>{mediaRow(row)}</div>
          </section>
        )
      })}
    </div>
  )
}
