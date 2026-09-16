/**
 * The in-window home: the `Rail` seated in the main sidebar's `sidebar.rail`
 * slot while the column is collapsed. There is no window to transform, so the
 * project cell expands the sidebar, the Studio entry raises the in-window
 * Studio request, and a chip click opens that chat in the conversation pane;
 * a hold still reaches the panel.
 * @module @idealize/askbar/src/client/SidebarRail
 */

import React, { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the `sidebar.rail` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { AskbarStore } from './askbar-store.ts'
import { Rail } from './Rail.tsx'

/** What the slot registration hands the sidebar rail. */
export interface SidebarRailInjected {
  /** The observable bar view (the project it follows rides in the view). */
  store: AskbarStore
  /**
   * Open one chat in the conversation pane.
   * @param sessionId - the chip's session id.
   */
  openSession: (sessionId: string) => void
  /** Open the Studio chat in this window. */
  openStudio: () => void
}

/** Sidebar rail props: the injected face, the seat's owner share and the locale seat. */
export type SidebarRailProps = SidebarRailInjected & PropsRuntime<'sidebar.rail'> & PropsLocale<'idealize-askbar'>

/**
 * Render the rail in the collapsed sidebar.
 * @param props - the injected face, owner share and locale seat.
 * @returns the rail column.
 */
export function SidebarRail(props: SidebarRailProps): React.JSX.Element {
  const { store, openSession, openStudio, expandSidebar, t } = props
  const view = useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())
  return (
    <Rail
      view={view}
      home='sidebar'
      onOpenMain={(open) => {
        if (open === 'studio') openStudio()
        else expandSidebar()
      }}
      onOpenChip={(chip) => { openSession(chip.id) }}
      t={t}
    />
  )
}
