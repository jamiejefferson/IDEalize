/**
 * The Studio view, browser half. Three registrations over one store:
 *
 * - the `studio` entry in the conversation view ring: the Studio chat (a chat
 *   in the `studio` space, opened from the pinned Studio card) renders every
 *   project's coordination full-height over the ordinary composer;
 * - an `@` source, "Agents", for the composer's trigger menu: every named chat
 *   across every project, inserting `@Name `, so an address in the Studio
 *   chat autocompletes (JJ, 3 Sep 2026);
 * - the `studioSection` service — the view component, its wired face and the
 *   store — so `@idealize/ui-bar`'s pinned card reads the same state without
 *   a value import, which the client bundle purity gate forbids. Same seam as
 *   `scheduleSection` and `trajectorySection` (FORK.md).
 *
 * Studio data belongs to `@idealize/studio` and travels over its own loopback
 * routes, so this half owns no records, no ids and no permissions.
 * @module @idealize/ui-studio/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
// Type-only: comm's SessionProjectionMap merge (agentName on the session list).
import type {} from '@idealize/comm/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the conversation service's Context merge (ctx.conversation) and
// the `conversation.view` SlotMap merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { StudioView } from './StudioView.tsx'
import type { StudioViewInjected } from './StudioView.tsx'
import { createStudioStore } from './store.ts'
import type { StudioStore } from './store.ts'
import { en, NS, zh } from './locales.ts'

/** The ring entry id; equals the `studio` space id, which is how the ring is seeded. */
export const STUDIO_VIEW = 'studio'

export { StudioView } from './StudioView.tsx'

/** What the name projection reads off a session-list snapshot. */
interface NamedSessions {
  byId: Record<string, { projectionValues?: { agentName?: { name?: string | undefined } | undefined } | undefined }>
}

/**
 * Build the session-id-to-agent-name projection. It returns the previous map,
 * by reference, while the names are shallow-equal (same ids, same names), so a
 * selector over it holds still across session updates that rename nobody.
 * @returns the projection from a session-list snapshot to its name map.
 */
export function createNameProjection(): (snapshot: NamedSessions) => Record<string, string> {
  let last: Record<string, string> | undefined
  return (snapshot) => {
    const names: Record<string, string> = {}
    for (const [id, summary] of Object.entries(snapshot.byId)) {
      const name = summary.projectionValues?.agentName?.name
      if (name !== undefined) names[id] = name
    }
    if (last !== undefined) {
      const ids = Object.keys(names)
      const previous = last
      if (ids.length === Object.keys(previous).length && ids.every(id => previous[id] === names[id])) return previous
    }
    last = names
    return names
  }
}
export type { StudioViewInjected, StudioViewProps } from './StudioView.tsx'
export { createStudioStore } from './store.ts'
export type { StudioStore, StudioViewState } from './store.ts'
export type { StudioKey } from './locales.ts'
export type {
  AgentViewRow, DeliveryState, EventRow, HandoffRow, OverviewResponse, ProjectView, StateResponse, StudioPresence,
  StudioTranslate, SynthesisRow, TaskAttention, TaskExecutionState, TaskRow, TimelineResponse,
} from './studio-model.ts'

/**
 * Required services: the slot registry (the ring entry), copy, the session
 * rows (the `@` roster + navigation), the chat surface the reveal targets,
 * and the composer's trigger pipeline.
 */
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'inputTriggers']

/**
 * The Studio view as a service (IDEalize fork seam): the pinned Studio card in
 * `@idealize/ui-bar` reads the project state through it, and the client bundle
 * purity gate forbids cross-plugin value imports, so the consumer takes the
 * component, its wired face and the store through the Context.
 */
export interface StudioSectionHost {
  /** The view component, rendered by the consuming surface. */
  Component: typeof StudioView
  /**
   * Wire the view: the store-bound selector hook, sync, source navigation,
   * the read-position and focus writes, and the bound translate. One store
   * serves the one Studio.
   * @returns the wired face.
   */
  face: () => StudioSectionFace
  /** The shared store, so a consumer can poll without mounting the view. */
  store: StudioStore
}

/** The wired face: every prop the pane needs beyond React's own. */
export type StudioSectionFace = StudioViewInjected & PropsLocale<'idealize-studio'>

declare module '@deepseek-ai/cordis' {
  interface Context {
    studioSection: StudioSectionHost
  }
}

/**
 * Client plugin body: register the dictionaries, the ring entry and the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-studio: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.sessions

  // The view's data (every project's folded state and recent timeline) lives
  // here, not in the component: leaving the Studio chat unmounts the view, and
  // coming back must land on the same state without a blank flash.
  const store = createStudioStore()
  const useStudio = bindSnapshotSelector(store.state)

  // The timeline's source.thread crossed the studio wire as a string; rebrand
  // it where it re-enters the typed session surface. The reveal is aimed
  // before the open, so the mount the open triggers consumes it (FR-P0-23:
  // land at the event's turn, not the reader position).
  const openThread = (sessionId: string, at?: string): void => {
    const ms = at === undefined ? Number.NaN : Date.parse(at)
    if (!Number.isNaN(ms)) ctx.conversation.revealAt(sessionId as SessionId, ms)
    sessions.open(sessionId as SessionId)
  }

  const markRead = (project: string, seq: number): void => { void store.markRead(project, seq) }

  // Session id to agent name, straight off the session list: the timeline
  // records authors as ids, and the view has no other way to read them as
  // people. The same projection the `@` source below autocompletes from, so a
  // reference and its completion can never name the participant differently.
  // The map is rebuilt per snapshot but handed on by reference while its
  // content stands, so a session update that renames nobody re-renders nothing.
  const useNames = bindSnapshotSelector(sessions.list)
  const project = createNameProjection()
  function namesOf<T>(selector: (names: Record<string, string>) => T): T {
    return useNames(snapshot => selector(project(snapshot)))
  }

  // Start a reply to one agent: `@Name ` into the open chat's draft, which is
  // the Studio chat while the view is mounted. The host's routing reads the
  // leading address, so the person types the message and sends.
  const address = (name: string): void => {
    const current = sessions.list.getSnapshot().current
    if (current === undefined) return
    const binding = sessions.binding(current)
    if (binding === undefined) return
    const input = ctx.conversation.input.for(binding.ctx)
    const draft = input.state.getSnapshot().draft
    // A leading address is the only one the host routes, so an address goes
    // to the front of an existing draft rather than the end.
    input.setDraft(draft === '' ? `@${name} ` : `@${name} ${draft}`)
  }

  const face = (): StudioSectionFace => ({
    useStudio,
    sync: store.sync,
    openThread,
    takeFocus: store.takeFocus,
    markRead,
    useNames: namesOf,
    address,
    t,
  })

  // Literal `name`/`id`: the generated client slot catalog reads occupancy off
  // this call site.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'studio',
    order: 7,
    locale: NS,
    label: () => t('studio.title'),
    inject: face,
  }, StudioView))

  // `@` autocompletes agents: every named chat across every project, the
  // project as the hint. Any chat may address an agent, so the source is not
  // gated to the Studio chat; the host routes the address when the sending
  // chat is the Studio's.
  const agents = (query: string): { name: string; hint: string }[] => {
    const { byId } = sessions.list.getSnapshot()
    const lower = query.toLowerCase()
    const rows: { name: string; hint: string }[] = []
    const seen = new Set<string>()
    for (const summary of Object.values(byId)) {
      const name = summary.projectionValues?.agentName?.name
      if (name === undefined || seen.has(name) || !name.toLowerCase().includes(lower)) continue
      seen.add(name)
      rows.push({ name, hint: (summary.cwd ?? '').split(/[\\/]/).filter(Boolean).at(-1) ?? '' })
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name))
  }
  const source: InputTriggerSource = {
    trigger: '@',
    name: t('studio.agents.source'),
    order: -1,
    candidates(_session, { query }) {
      return Promise.resolve(agents(query).map(row => ({ name: row.name, hint: row.hint })))
    },
    lexicon() {
      return agents('').map(row => row.name)
    },
    subscribeLexicon(_session, listener) {
      return sessions.list.subscribe(listener)
    },
    onPick({ candidate }) {
      // Plain text: the address ships to the host verbatim, which is what the
      // Studio's routing reads (trailing space closes the token).
      return { text: `@${candidate.name} ` }
    },
    codec: {
      clipboardText: ref => `@${ref}`,
      serialize: ref => Promise.resolve(`@${ref}`),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'idealize-studio: @ agents source')

  ctx.provide('studioSection', { Component: StudioView, face, store } satisfies StudioSectionHost)
}
