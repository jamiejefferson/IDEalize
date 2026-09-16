/**
 * The Schedule view, browser half. It provides one thing — the
 * `scheduleSection` service: the calendar component plus its wired face — so
 * the consuming surface (`@idealize/ui-bar`'s drawer pane) renders it without
 * a value import, which the client bundle purity gate forbids across plugins.
 * Same seam as `modelsSettingsSection`, `agentPresetSection` and
 * `trajectorySection` (FORK.md).
 *
 * Schedule data belongs to `@idealize/cron` and travels over its own loopback
 * routes, so this half owns no records, no ids and no permissions — it is a
 * client of that service exactly as the ring view was.
 * @module @idealize/ui-schedule/client
 */

import type { ClientContext, SessionBinding } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ScheduleView } from './ScheduleView.tsx'
import type { ScheduleViewInjected } from './ScheduleView.tsx'
import { createScheduleStore } from './store.ts'
import { en, NS, zh } from './locales.ts'

export { ScheduleView, saveTask } from './ScheduleView.tsx'
export type { ScheduleViewInjected, ScheduleViewProps } from './ScheduleView.tsx'
export { ScheduleEditor } from './ScheduleEditor.tsx'
export { ScheduleCreateChat } from './ScheduleCreateChat.tsx'
export { createScheduleStore } from './store.ts'
export type { ScheduleGrain, ScheduleMode, ScheduleStore, ScheduleViewState } from './store.ts'
export type { ScheduleKey } from './locales.ts'
export type {
  ParsedDraft, Schedule, ScheduleTranslate, TaskDraft, TaskView,
} from './schedule-model.ts'

/** Required services: copy, session rows, and the workspace registry. */
export const inject = ['locale', 'sessions', 'workspaces']

/**
 * The calendar as a service (IDEalize fork seam): Schedule left the
 * conversation view ring for a tool-rail drawer pane, and the client bundle
 * purity gate forbids cross-plugin value imports, so the consuming surface
 * takes the component and its wired face through the Context.
 */
export interface ScheduleSectionHost {
  /** The calendar component, rendered by the consuming surface. */
  Component: typeof ScheduleView
  /**
   * Wire the calendar: the store-bound selector hook, its writers, the
   * workspace/session plumbing, and the bound translate. One calendar serves
   * every chat, so the face takes no session.
   * @returns the wired face.
   */
  face: () => ScheduleSectionFace
}

/**
 * The wired face: every prop the calendar needs. The store-bound hook is
 * stable because the store is, so the consuming surface may call face() on
 * each render.
 */
export type ScheduleSectionFace = ScheduleViewInjected & PropsLocale<'idealize-schedule'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    scheduleSection: ScheduleSectionHost
  }
}

/**
 * Client plugin body: register the dictionaries and publish the calendar.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-schedule: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.sessions
  const workspaces = ctx.workspaces

  // The view's position (navigated day, open editor) lives here, not in the
  // component: the drawer unmounts a closed pane, so component state would be
  // lost the moment the user closes it (SCH-09).
  const store = createScheduleStore()
  const useSchedule = bindSnapshotSelector(store.state)

  /**
   * A fresh blank session in the workspace at `path` (created if unknown),
   * selected on the main surface. Create-with-chat is a real conversation and
   * must not land in an unrelated chat's transcript, and an off-stage session
   * receives no transcript stream for the pane to mirror.
   */
  const freshSession = async (path: string): Promise<SessionBinding | null> => {
    const view = await workspaces.create({ path })
    const sessionId = await workspaces.connectWorkspace(view.workspaceId)
    sessions.open(sessionId)
    return sessions.binding(sessionId) ?? null
  }

  ctx.provide('scheduleSection', {
    Component: ScheduleView,
    face: () => ({
      useSchedule,
      setDate: store.setDate,
      setMode: store.setMode,
      setGrain: store.setGrain,
      workspaces: () => workspaces.list.getSnapshot().items.map(item => ({ name: item.title, path: item.path })),
      currentCwd: () => {
        const current = sessions.list.getSnapshot().current
        return current === undefined ? undefined : sessions.list.getSnapshot().byId[current]?.cwd
      },
      ensureSession: freshSession,
      t,
    }),
  } satisfies ScheduleSectionHost)
}
