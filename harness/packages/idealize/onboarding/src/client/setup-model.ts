/**
 * The set-up step's pure rules: which coding-subscription rows the Terminal's
 * launch choices produce, which row starts selected, and which app the
 * Terminal's current launch command belongs to. No React and no fetch, so the
 * step, the welcome sheet and their specs share one reading of the catalogue.
 * @module @idealize/onboarding/client/setup-model
 */

import type { LaunchChoice } from './api.ts'
import type { OnboardingKey } from './locales.ts'

/** The companies whose subscriptions the set-up step offers, in display order. */
export const SETUP_COMPANIES = ['claude', 'chatgpt', 'gemini', 'kimi'] as const

/** One company the set-up step offers. */
export type SetupCompany = (typeof SETUP_COMPANIES)[number]

/** One row of the coding-subscription list. */
export interface CodingRow {
  /** The company the subscription is with. */
  company: SetupCompany
  /** The launch choice id this row selects, which the align route takes as `cli`. */
  id: string
  /** Whether the app is installed; null where the check cannot run. */
  installed: boolean | null
}

/**
 * The launch choice ids behind each company, most preferred first: the row
 * uses the first installed one, else the first the catalogue lists. Gemini has
 * two apps, and Antigravity (`agy`) is preferred when it is installed.
 */
const COMPANY_CHOICES: Record<SetupCompany, readonly string[]> = {
  claude: ['claude-code'],
  chatgpt: ['codex'],
  gemini: ['antigravity', 'gemini'],
  kimi: ['kimi'],
}

/** Each company's name on its row. */
export const COMPANY_LABEL: Record<SetupCompany, OnboardingKey> = {
  claude: 'setup.company.claude',
  chatgpt: 'setup.company.chatgpt',
  gemini: 'setup.company.gemini',
  kimi: 'setup.company.kimi',
}

/** The app name on each company's row. */
export const COMPANY_APP: Record<SetupCompany, OnboardingKey> = {
  claude: 'setup.app.claude',
  chatgpt: 'setup.app.chatgpt',
  gemini: 'setup.app.gemini',
  kimi: 'setup.app.kimi',
}

/** The name of the models Chat starts on for each company's subscription. */
export const COMPANY_MODELS: Record<SetupCompany, OnboardingKey> = {
  claude: 'setup.models.claude',
  chatgpt: 'setup.models.chatgpt',
  gemini: 'setup.models.gemini',
  kimi: 'setup.models.kimi',
}

/**
 * Build the coding-subscription rows from the Terminal's launch choices. A
 * company none of whose apps the catalogue lists gets no row.
 * @param catalog - the launch choices with their installed flags.
 * @returns the rows, in {@link SETUP_COMPANIES} order.
 */
export function codingRows(catalog: readonly LaunchChoice[]): CodingRow[] {
  const rows: CodingRow[] = []
  for (const company of SETUP_COMPANIES) {
    const choices = COMPANY_CHOICES[company]
      .map(id => catalog.find(entry => entry.id === id))
      .filter((entry): entry is LaunchChoice => entry !== undefined)
    const choice = choices.find(entry => entry.installed === true) ?? choices[0]
    if (choice !== undefined) rows.push({ company, id: choice.id, installed: choice.installed })
  }
  return rows
}

/**
 * The row that starts selected: the first whose app is installed.
 * @param rows - the coding-subscription rows.
 * @returns the row's launch choice id, or null when nothing is installed.
 */
export function firstInstalled(rows: readonly CodingRow[]): string | null {
  return rows.find(row => row.installed === true)?.id ?? null
}

/**
 * The launch choice the Terminal's current default command belongs to: the
 * choice with the same command, else the first whose program name matches.
 * @param command - the Terminal's default launch command.
 * @param catalog - the launch choices.
 * @returns the choice, or undefined for a command no choice accounts for.
 */
export function launchChoiceOf(command: string, catalog: readonly LaunchChoice[]): LaunchChoice | undefined {
  const typed = command.trim()
  const exact = catalog.find(entry => entry.command === typed)
  if (exact !== undefined) return exact
  const program = typed.split(' ')[0]
  return program === undefined || program === '' ? undefined : catalog.find(entry => entry.command.split(' ')[0] === program)
}
