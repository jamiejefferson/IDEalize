/**
 * The set-up state the wizard's step and the welcome sheet share: what the
 * host reports (installed coding apps, connected keys, the Terminal's launch
 * command), what the person has chosen and pasted, and the saves behind the
 * primary button. Keys are saved when the primary button is pressed, never as
 * they are typed.
 * @module @idealize/onboarding/client/use-setup
 */

import { useEffect, useState } from 'react'
import type { LaunchChoice, OnboardingApi } from './api.ts'
import type { OnboardingKey } from './locales.ts'
import { codingRows } from './setup-model.ts'
import type { CodingRow } from './setup-model.ts'

/** What the host reported at the last read. */
export interface SetupFacts {
  /** The coding-subscription rows. */
  rows: CodingRow[]
  /** The Terminal's launch choices. */
  catalog: LaunchChoice[]
  /** The Terminal's default launch command. */
  launchCommand: string
  /** Whether an OpenRouter key is connected. */
  openrouter: boolean
  /** Whether a fal key is connected. */
  fal: boolean
  /** How many models a fal key adds; null when the host states no count. */
  falModelCount: number | null
  /** Whether a key gateway is connected. */
  gateway: boolean
}

/** The shared set-up state and its actions. */
export interface Setup {
  /** The host's report; null until the first read lands. */
  facts: SetupFacts | null
  /** True when the first read failed. */
  loadFailed: boolean
  /** The selected coding app's launch choice id. */
  selected: string | null
  /** Select a coding app. */
  select: (id: string) => void
  /** The pasted OpenRouter key. */
  openrouterDraft: string
  /** Change the pasted OpenRouter key. */
  setOpenrouterDraft: (value: string) => void
  /** The OpenRouter save's refusal, shown under its field. */
  openrouterError: string | null
  /** The pasted fal key. */
  falDraft: string
  /** Change the pasted fal key. */
  setFalDraft: (value: string) => void
  /** The fal save's refusal, shown under its field. */
  falError: string | null
  /** The align call's refusal, shown under the coding list. */
  alignError: string | null
  /** Read the host again. */
  refresh: () => void
  /**
   * Save each pasted key through its route. A saved key's field empties and
   * its part reads as connected; a refused key's reason shows under its field.
   * @returns false when a key was refused.
   */
  saveKeys: () => Promise<boolean>
  /**
   * Make the selected coding app the Terminal's default and start Chat on the
   * same company's models. Does nothing when no app is selected.
   * @returns false when the host refused.
   */
  alignSelected: () => Promise<boolean>
}

/**
 * Hold the set-up state for one mounted surface.
 * @param api - the route client.
 * @param t - the namespace translator.
 * @returns the state and its actions.
 */
export function useSetup(api: OnboardingApi, t: (key: OnboardingKey) => string): Setup {
  const [facts, setFacts] = useState<SetupFacts | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [openrouterDraft, setOpenrouterDraft] = useState('')
  const [openrouterError, setOpenrouterError] = useState<string | null>(null)
  const [falDraft, setFalDraft] = useState('')
  const [falError, setFalError] = useState<string | null>(null)
  const [alignError, setAlignError] = useState<string | null>(null)

  const refresh = (): void => {
    Promise.all([api.loadAgents(), api.loadLaunches(), api.loadGateway(), api.loadFalModelCount()])
      .then(([agents, launches, gateway, falModelCount]) => {
        // Where the host serves no Terminal, Claude Code's own detection still gives one row.
        const catalog: LaunchChoice[] = launches?.catalog
          ?? [{ id: 'claude-code', label: 'Claude Code', command: 'claude', installed: agents.claudeCode.installed }]
        setFacts({
          rows: codingRows(catalog),
          catalog,
          launchCommand: launches?.default ?? agents.launchCommand ?? '',
          openrouter: agents.openrouter.connected,
          fal: agents.fal?.connected === true,
          falModelCount,
          gateway,
        })
      }, () => { setLoadFailed(true) })
  }
  useEffect(() => {
    refresh()
    // Mount-only: each surface reads the host once on entry.
  }, [])

  const saveKeys = async (): Promise<boolean> => {
    setOpenrouterError(null)
    setFalError(null)
    const openrouterKey = openrouterDraft.trim()
    if (openrouterKey !== '') {
      const outcome = await api.connectOpenRouter(openrouterKey).catch(() => ({ ok: false as const, error: t('setup.openrouter.unreachable') }))
      if (!outcome.ok) {
        setOpenrouterError(outcome.error)
        return false
      }
      setOpenrouterDraft('')
      setFacts(current => current === null ? current : { ...current, openrouter: true })
    }
    const falKey = falDraft.trim()
    if (falKey !== '') {
      const outcome = await api.connectFal(falKey).catch(() => ({ ok: false as const, error: t('setup.fal.unreachable') }))
      if (!outcome.ok) {
        setFalError(outcome.error)
        return false
      }
      setFalDraft('')
      setFacts(current => current === null ? current : { ...current, fal: true })
    }
    return true
  }

  const alignSelected = async (): Promise<boolean> => {
    setAlignError(null)
    if (selected === null) return true
    const outcome = await api.align(selected).catch(() => ({ ok: false as const, error: t('setup.align.unreachable') }))
    if (!outcome.ok) setAlignError(outcome.error)
    return outcome.ok
  }

  return {
    facts,
    loadFailed,
    selected,
    select: setSelected,
    openrouterDraft,
    setOpenrouterDraft,
    openrouterError,
    falDraft,
    setFalDraft,
    falError,
    alignError,
    refresh,
    saveKeys,
    alignSelected,
  }
}
