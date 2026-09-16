/**
 * Settings-shell trigger shadow: the fork occupies the shell's single
 * `settings.trigger` seat with an occupant that renders nothing, and
 * ui-settings-general hides a trigger whose seat is empty, so the sidebar
 * foot carries no Settings / Service hatch link. The hatch lives in the
 * rail's drawer pane; the settings modal stays reachable through the
 * `settingsOpen` service.
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Trigger content props: the sidebar column state + the bar's locale seat. */
export type HatchTriggerProps = PropsRuntime<'settings.trigger'> & PropsLocale<'idealize-bar'>

/**
 * The sidebar-foot trigger seat: empty.
 * @returns null.
 */
export function HatchTrigger(_props: HatchTriggerProps) {
  return null
}

/**
 * The empty occupant of the General settings' Language row: the product ships
 * in English only, so the row renders nothing.
 * @returns null.
 */
export function NoLanguageRow() {
  return null
}

/**
 * The empty occupant of the settings onboarding list's DeepSeek entry: the
 * product routes DeepSeek through OpenRouter, so the "configure the official
 * DeepSeek provider" dialog renders nothing.
 * @returns null.
 */
export function NoProviderDialog() {
  return null
}
