/**
 * The collapse-to-Askbar button (mini mode) on the sidebar header's `sidebar.header.action`
 * seat, on the collapse toggle's row, so it sits with the other
 * window-level controls (JJ, 2026-08-28) rather than among the rail's panes.
 * Renders nothing outside the desktop shell: `/idealize/bar/capabilities`
 * reports `shellMode: null` there.
 */
import { useEffect, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the ui-sidebar SlotMap merge that declares the header seat.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BarIconMinimode } from './BarIcons.tsx'
import css from './MinimodeButton.module.css'

/** Glyph size, matching the sidebar header's 16px icons. */
const ICON = 16

interface Capabilities {
  shellMode: 'compatibility' | 'advanced' | null
}

export type MinimodeButtonProps = PropsRuntime<'sidebar.header.action'> & PropsLocale<'idealize-bar'>

/**
 * The collapse button.
 * @param props - the sidebar column state and the bar's locale seat.
 * @returns the button, or null outside the desktop shell.
 */
export function MinimodeButton({ t }: MinimodeButtonProps) {
  const [capabilities, setCapabilities] = useState<Capabilities>({ shellMode: null })

  useEffect(() => {
    let cancelled = false
    void fetch('/idealize/bar/capabilities')
      .then(response => response.json() as Promise<Capabilities>)
      .then((body) => { if (!cancelled) setCapabilities(body) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (capabilities.shellMode === null) return null
  const label = t('bar.minimode.on')
  const toggle = (): void => {
    // The shell collapses this window to the Askbar in place; the bar's own
    // controls expand it back, so this button never shows a pressed state.
    void fetch('/idealize/bar/minimode', { method: 'POST', headers: { 'x-idealize-auth': '1' } }).catch(() => {})
  }
  return (
    <Tooltip label={label} delayMs={500}>
      <button
        type="button"
        className={css.button}
        aria-label={label}
        onClick={toggle}
      >
        <BarIconMinimode size={ICON} />
      </button>
    </Tooltip>
  )
}
