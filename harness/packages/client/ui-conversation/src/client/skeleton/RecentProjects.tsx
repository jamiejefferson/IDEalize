/**
 * V0's recent-project launch cards on the welcome slate: up to three
 * workspaces ranked by their sessions' last activity, each a one-click way
 * back into that project. Recency is derived client-side from the session
 * list (the host keeps no last-used stamp) — the same inputs the runtime's
 * recentWorkspaceId projection reduces to one id.
 */
import type {
  SessionListState, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './RecentProjects.module.css'

type HeroTranslate = ConversationSlotProps['t']

const SHOWN_LIMIT = 3

/** Rank workspaces by their latest session activity, newest first. */
export function rankRecentWorkspaces(
  workspaces: readonly WorkspaceView[],
  sessions: SessionListState['byId'],
  limit = SHOWN_LIMIT,
): WorkspaceView[] {
  const stamped = workspaces.map((workspace) => {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = sessions[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    return { workspace, latest }
  })
  stamped.sort((a, b) => b.latest - a.latest)
  return stamped.slice(0, limit).map(entry => entry.workspace)
}

export interface RecentProjectsProps {
  workspaces: readonly WorkspaceView[]
  sessions: SessionListState['byId']
  /** The workspace this blank session already sits in — no card for it. */
  excludeId?: WorkspaceId | undefined
  onPick: (workspaceId: WorkspaceId) => void
  t: HeroTranslate
}

/**
 * Render the recent-project cards, or nothing when no workspace exists yet.
 * @param props - see {@link RecentProjectsProps}.
 * @returns the card row.
 */
export function RecentProjects({ workspaces, sessions, excludeId, onPick, t }: RecentProjectsProps) {
  const candidates = excludeId === undefined
    ? workspaces
    : workspaces.filter(workspace => workspace.workspaceId !== excludeId)
  const recent = rankRecentWorkspaces(candidates, sessions)
  if (recent.length === 0) return null
  return (
    <div className={css.root} aria-label={t('hero.recents')} data-recent-projects="">
      {recent.map(workspace => (
        <button
          key={workspace.workspaceId}
          type="button"
          className={css.card}
          onClick={() => { onPick(workspace.workspaceId) }}
        >
          <span className={css.title}>{workspace.title}</span>
          <span className={css.path}>{workspace.path}</span>
        </button>
      ))}
    </div>
  )
}
