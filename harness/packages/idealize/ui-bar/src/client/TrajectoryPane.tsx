/**
 * The Trajectory drawer pane: `@deepseek-ai/dsh-client-ui-trajectory`'s event
 * ledger, re-hosted beside the conversation instead of inside the view ring.
 * The ledger's plugin publishes the component and a per-chat wired face as the
 * `trajectorySection` service (FORK.md), because the client bundle purity gate
 * forbids importing another plugin's value exports.
 *
 * The pane follows the current chat and remounts the ledger per chat, so one
 * chat's folds, search and selection never carry into another's.
 * @module @idealize/ui-bar/client/TrajectoryPane
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the inspect handoff's own type, owned by the chat view's contract.
import type { ConvViewOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the ledger service's component and face types.
import type { TrajectorySectionHost } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { BarKey } from './locales.ts'
import css from './TrajectoryPane.module.css'

/** The ledger plugin's section service as the drawer consumes it (index.ts binds it once). */
export interface TrajectoryHost {
  /** The ledger component. */
  Component: TrajectorySectionHost['Component']
  /**
   * Wire the ledger for one chat.
   * @param sessionId - the chat whose ledger renders.
   * @returns the wired face, or undefined while that chat has no binding.
   */
  face: (sessionId: SessionId) => ReturnType<TrajectorySectionHost['face']>
}

export interface TrajectoryPaneProps {
  /** The re-hosted ledger. */
  host: TrajectoryHost
  /** The chat whose ledger shows; undefined while no chat is open. */
  sessionId: SessionId | undefined
  /** A pending inspect handoff for THIS chat, or null when nothing is outstanding. */
  inspect: Exclude<ConvViewOwnerProps['inspect'], undefined>
  /** Acknowledge the handoff once the ledger has revealed the record. */
  onInspectDone: () => void
  /** Pane copy. */
  t: (key: BarKey) => string
}

/**
 * Render the ledger for the current chat.
 * @param props - the host, the current chat, and the inspect handoff.
 * @returns the ledger, or the no-chat statement.
 */
export function TrajectoryPane({ host, sessionId, inspect, onInspectDone, t }: TrajectoryPaneProps) {
  const face = sessionId === undefined ? undefined : host.face(sessionId)
  if (face === undefined) {
    return <p className={css.empty}>{t('trajectory.empty')}</p>
  }
  const Ledger = host.Component
  return (
    <div className={css.root} data-trajectory-pane={sessionId}>
      <Ledger key={sessionId} {...face} inspect={inspect} onInspectDone={onInspectDone} />
    </div>
  )
}
