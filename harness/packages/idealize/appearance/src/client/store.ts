/**
 * The appearance panel's view state: open state and active tab, a mirror of
 * the durable section, a mirror of ui-theme's mode, and the installed font
 * families. The plugin's apply world is the only writer; the panel reads
 * through its `useAppearance` hook prop.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { APPEARANCE_DEFAULTS, type AppearanceSettings } from '../appearance-settings.ts'

/** Light/dark/system (restated; ui-theme owns the schema). */
export type ModeId = 'light' | 'dark' | 'system'

/** The panel's tabs (V0 AppearanceSection). */
export const SECTIONS = ['theme', 'sessions', 'files', 'chat', 'doc', 'terminal'] as const

/** One of {@link SECTIONS}. */
export type SectionId = typeof SECTIONS[number]

/** Panel state. */
export interface AppearanceState {
  /** Whether the panel is shown. */
  open: boolean
  /** Active tab. */
  section: SectionId
  /** Last accepted durable section (defaults until the first acceptance). */
  settings: AppearanceSettings
  /** ui-theme's persisted preference. */
  mode: ModeId
  /** The palette scheme currently painted (system resolved). */
  scheme: 'light' | 'dark'
  /** Installed font families; undefined until the Host answers. */
  fonts: string[] | undefined
  /** The fixed-pitch subset of {@link fonts} (the terminal picker lists these first). */
  monospaced: string[]
}

/** The panel's observable state. */
export type AppearanceStore = SnapshotStore<AppearanceState>

/**
 * Create the panel state store.
 * @returns the store, closed on the Theme tab at the defaults.
 */
export function createAppearanceStore(): AppearanceStore {
  return createSnapshotStore<AppearanceState>({
    open: false,
    section: 'theme',
    settings: structuredClone(APPEARANCE_DEFAULTS),
    mode: 'system',
    scheme: 'light',
    fonts: undefined,
    monospaced: [],
  })
}
