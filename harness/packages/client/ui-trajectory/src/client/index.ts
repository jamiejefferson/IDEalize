/**
 * Browser trajectory plugin: the target-specific Event Definitions, the
 * Trajectory view builder, and the ledger itself published as the
 * `trajectorySection` service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ConvViewOwnerProps inspect handoff TrajectoryView still takes.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createTrajectoryDurationStore } from './duration-store.ts'
import { en, NS, zh } from './locales.ts'
import { registerTrajectoryAssistantDefinition } from './trajectory-assistant-definition.ts'
import { registerTrajectoryCompactionDefinitions } from './trajectory-compaction-definition.ts'
import { registerTrajectoryMessageDefinitions } from './trajectory-message-definitions.ts'
import { registerTrajectoryRequestHeaderDefinition } from './trajectory-request-header-definition.ts'
import { registerTrajectoryConversationView } from './trajectory-snapshot-builder.ts'
import { registerTrajectoryToolDefinition } from './trajectory-tool-definition.ts'
import { TrajectoryView, type TrajectoryViewInjected } from './TrajectoryView.tsx'

/**
 * The ledger as a service (IDEalize fork seam): Trajectory left the
 * conversation view ring for a tool-rail drawer pane, and the client bundle
 * purity gate forbids cross-plugin value imports, so the consuming surface
 * takes the component and its per-chat wired face through the Context. Same
 * pattern as `modelsSettingsSection` and `agentPresetSection`.
 */
export interface TrajectorySectionHost {
  /** The ledger component, rendered by the consuming surface. */
  Component: typeof TrajectoryView
  /**
   * Wire the ledger for one chat.
   * @param sessionId - the chat whose ledger renders.
   * @returns the wired face, or undefined while that chat has no binding.
   */
  face: (sessionId: SessionId) => TrajectorySectionFace | undefined
}

/**
 * The wired face: every prop the ledger needs except the inspect handoff,
 * which belongs to whichever surface routes a chat's Inspect click here.
 */
export type TrajectorySectionFace = TrajectoryViewInjected & PropsLocale<'trajectory'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    trajectorySection: TrajectorySectionHost
  }
}

/** Required services: the registries, ordinary Session paging, and the locale service. */
export const inject = ['conversationEvents', 'conversationViews', 'sessions', 'locale']

/**
 * Client plugin body: register the Definitions and publish the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-trajectory: dictionaries')
  const t = ctx.locale.bind(NS)
  // One browser-wide preference, so a chat's ledger opens the way the last one
  // was left; the bound hook is stable because the store is.
  const duration = createTrajectoryDurationStore()
  const useDuration = bindSnapshotSelector(duration)
  registerTrajectoryMessageDefinitions(ctx)
  registerTrajectoryRequestHeaderDefinition(ctx)
  registerTrajectoryAssistantDefinition(ctx)
  registerTrajectoryToolDefinition(ctx)
  registerTrajectoryCompactionDefinitions(ctx)
  registerTrajectoryConversationView(ctx)
  // Per-chat hooks are cached on the binding's session object: a fresh
  // selector hook per render would remount every uSES subscription in the
  // ledger, and the consuming surface calls face() on each of its renders.
  const sessionHooks = new WeakMap<object, TrajectoryViewInjected['useSession']>()
  ctx.provide('trajectorySection', {
    Component: TrajectoryView,
    face: (sessionId) => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) return undefined
      let useSession = sessionHooks.get(session)
      if (useSession === undefined) {
        useSession = bindSnapshotSelector(session)
        sessionHooks.set(session, useSession)
      }
      return {
        useSession,
        useDuration,
        loadOlder: async () => {
          const before = session.getSnapshot().views.get('trajectory')
          await session.loadOlder()
          return session.getSnapshot().views.get('trajectory') !== before
        },
        setActualDuration: (value) => { duration.set(value) },
        t,
      }
    },
  } satisfies TrajectorySectionHost)
}
