/**
 * @idealize/activity-pills — browser half: the composer's three-dot overflow
 * control on the `conversation.input.access` seat, holding the project's
 * access mode (handed in by the composer) and the brain switcher, which offers
 * the brains of THIS chat's space in place of the composer's model dropdown;
 * and the `activityPills` service, the controller the welcome card
 * (`@idealize/ui-bar`) launches an activity brain through so the free-tokens
 * route and the roster default keep one owner. The composer's
 * `conversation.input.dock` seat gets nothing from this package: the overflow
 * panel is the only brain control on a started chat.
 * @module @idealize/activity-pills/client
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ui-conversation SlotMap merge (the composer's model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: the space vocabulary and the `space`/`brain` projection merge the
// switcher reads off the session summary. `@idealize/spaces/client` exports
// types alone, so nothing of that package reaches this bundle.
import type { SpaceId, SpaceRosterEntry } from '@idealize/spaces/client'
import type {} from '@idealize/spaces/client'
import { ActivityPillsController, type ActivityAvailabilityMap, type ActivityPillsFace, type PillSessionSummary } from './pills-store.ts'
import { ComposerOverflow } from './ComposerOverflow.tsx'
import type { ComposerBlockSource, ComposerOverflowInjected } from './ComposerOverflow.tsx'
import {
  BrainSwitcherController,
  type BrainAgent, type BrainSessionSummary, type TerminalLaunchTable,
} from './brain-switcher.ts'
import { en, zh, type ActivityKey } from './locales.ts'

export { BrainSwitcher, brainMeta } from './BrainSwitcher.tsx'
export { ComposerOverflow } from './ComposerOverflow.tsx'
export type { ComposerBlockSource, ComposerOverflowInjected, ComposerOverflowProps } from './ComposerOverflow.tsx'
export type { BrainSwitcherInjected, BrainSwitcherProps } from './BrainSwitcher.tsx'
export { BrainSwitcherController, composeBrains, launchOf } from './brain-switcher.ts'
export type {
  BrainAgent, BrainOption, BrainSessionSummary, BrainSwitcherReads, BrainSwitcherState,
  BrainSwitcherWrites, TerminalLaunchTable,
} from './brain-switcher.ts'
export { ActivityPillsController } from './pills-store.ts'
export type { ActivityAvailabilityMap, ActivityModelSelection, ActivityPill, ActivityPillsFace, ActivityPillsState, PillSessionSummary, PillsApi } from './pills-store.ts'
export type { ActivityModel, PillAvailability, PillReason, Surface, TerminalRun } from '../availability.ts'
export type { ActivityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The brain switcher's copy. */
    'idealize-activity': ActivityKey
  }
}

/**
 * The activity-brain controller as a cordis service, for the welcome card in
 * `@idealize/ui-bar`: one controller owns the free-tokens route and the roster
 * default, whichever surface selects an activity brain.
 */
export interface ActivityPillsHost {
  /** The wired face over the controller the brain switcher also uses. */
  face: () => ActivityPillsFace
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    activityPills: ActivityPillsHost
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'idealize-activity'

/** The agent-preset settings namespace on the host wire (restated; dsh-agent-presets owns it). */
const AGENT_PRESET_SETTINGS_NS = 'agent-presets'

/** `@idealize/spaces`' roster route: which brains work in which space. */
const SPACES_ROSTER_PATH = '/idealize/spaces'

/** `@idealize/spaces`' selection route: the durable record of a chat's space and brain. */
const SPACES_SELECT_PATH = '/idealize/spaces/select'

/** This package's own host route: each editable brain's resolved model and standing instructions. */
const ACTIVITY_AGENTS_PATH = '/idealize/activity/agents'

/** `@idealize/ui-terminal`'s launch-command route, absent outside the desktop app. */
const TERMINAL_LAUNCHES_PATH = '/idealize/terminal/launches'

/** The Chat⇄Terminal service face (restated; `@idealize/ui-terminal` owns it). */
interface TerminalModeLike {
  restart(sessionId: string, brainId: string): Promise<void>
}

/** The tool rail's pane service face (restated; `@idealize/ui-bar` owns it). */
interface IdealizeBarLike {
  addBrain(space: SpaceId): void
  show(panel: 'models'): void
}

/** The conversation service's composer blocks (restated; ui-conversation owns it). */
interface ConversationBlocksLike {
  blocks: { storeFor(sessionId: SessionId): ComposerBlockSource }
}

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions']

/**
 * Client plugin body: the composer's brain switcher and the `activityPills` service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-activity: dictionaries')

  const { api } = ctx.get('connection') as ConnectionHandle
  // ctx.get, not the Context property: this package compiles host and client
  // halves in one project, and the host session store's Context merge shadows
  // the client runtime's typing of this name.
  const sessions = ctx.get('sessions') as unknown as ISessions

  // ctx.get() is the sanctioned probe for a service this plugin does not
  // inject. The terminal plugin ships only in the desktop app, and the tool
  // rail is absent from the desktop mini frame; both surfaces still switch
  // brains, they just have no shell to restart and no pane to open.
  const probe = <T>(name: string, verb: keyof T & string): T | undefined => {
    const maybe = (ctx as unknown as { get(name: string): unknown }).get(name)
    return typeof (maybe as Record<string, unknown> | undefined)?.[verb] === 'function'
      ? maybe as T
      : undefined
  }
  const terminalMode = (): TerminalModeLike | undefined => probe<TerminalModeLike>('terminalMode', 'restart')
  const bar = (): IdealizeBarLike | undefined => probe<IdealizeBarLike>('idealizeBar', 'addBrain')

  const currentSession = (): PillSessionSummary | undefined => {
    const state = sessions.list.getSnapshot()
    const summary = state.current === undefined ? undefined : state.byId[state.current]
    return summary === undefined
      ? undefined
      : {
        id: summary.id,
        blank: summary.blank,
        ...summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset },
      }
  }

  // Free = the free-tokens auto route: the models plugin's policy picks the
  // model from the free engine's catalogue. Loopback route, same auth header
  // as every /idealize mutation.
  const freeRoute = async (): Promise<void> => {
    const response = await fetch('/idealize/models/mode', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
      body: JSON.stringify({ mode: 'auto' }),
    })
    if (!response.ok) throw new Error(`free route: ${String(response.status)}`)
  }

  // The model each activity brain selects on a started chat and whether
  // selecting it is safe now, both resolved by the host half.
  const availability = async (): Promise<ActivityAvailabilityMap> => {
    const response = await fetch('/idealize/activity/models')
    if (!response.ok) throw new Error(`activity models: ${String(response.status)}`)
    const { pills } = await response.json() as { pills: ActivityAvailabilityMap }
    return pills
  }

  const controller = new ActivityPillsController(
    api,
    currentSession,
    (sessionId, agentPreset) => { sessions.noteAgentPreset(sessionId as SessionId, agentPreset) },
    freeRoute,
    availability,
  )

  const face = (): ActivityPillsFace => ({
    hooks: { activityPills: controller.store },
    load: () => controller.load(),
    select: (id: string, session?: PillSessionSummary) => controller.select(id, session),
  })

  ctx.effect(() => {
    // The default is a settings field and the roster a live directory: a
    // change from the Models & usage drawer or another tab moves the list.
    const disposers = [
      ctx.remote.$on('settings/document-updated', (ns) => {
        if (ns !== AGENT_PRESET_SETTINGS_NS) return
        void controller.load()
      }),
      ctx.remote.$on('agent-preset/selected', (sessionId, agentPreset) => {
        sessions.noteAgentPreset(sessionId, agentPreset)
      }),
      ctx.on('connection/reset', () => { void controller.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'idealize-activity: roster refresh')

  // ── The brain switcher on the composer's model seat ────────────────────
  // The brain decides the model, so ui-model-selection's dropdown is shadowed
  // by a lower-priority occupant that asks the product's question instead:
  // which brain, out of the ones that work in THIS chat's space. The /model
  // command stays for the odd manual pick.
  const brains = new BrainSwitcherController(
    {
      roster: async () => {
        const response = await fetch(SPACES_ROSTER_PATH)
        if (!response.ok) throw new Error(`space roster: ${String(response.status)}`)
        return (await response.json() as { spaces: SpaceRosterEntry[] }).spaces
      },
      agents: async () => {
        const response = await fetch(ACTIVITY_AGENTS_PATH)
        if (!response.ok) throw new Error(`activity agents: ${String(response.status)}`)
        return (await response.json() as { agents: BrainAgent[] }).agents
      },
      launches: async () => {
        const response = await fetch(TERMINAL_LAUNCHES_PATH)
        // No terminal plugin means no shell to restart: an empty table makes
        // every brain's launch command identical, so nothing reads as a restart.
        if (!response.ok) return { default: '', byActivity: {} }
        return await response.json() as TerminalLaunchTable
      },
    },
    {
      recompose: async (brainId, session) => {
        // An ACTIVITY brain goes through the activity controller, which is
        // what routes Free to the free-tokens policy and moves the roster
        // default. Every other brain is written for THIS chat alone, so a
        // media agent never becomes what new chats open on.
        if (controller.store.getSnapshot().pills.some(pill => pill.id === brainId)) {
          await controller.select(brainId, session)
          return controller.store.getSnapshot().error
        }
        const response = await api.agentPresets.select({ sessionId: session.id as never, agentPreset: brainId })
        if (!response.result.ok) return response.result.error.message
        sessions.noteAgentPreset(session.id as SessionId, response.result.value.agentPreset)
        // The preset carries no model: a brain's chosen model is a `models`
        // entry the activity controller applies for its own brains, so this
        // path applies it here or the chat runs on the deployment default.
        const model = brains.store.getSnapshot().brains.find(brain => brain.id === brainId)?.model ?? null
        if (model === null) return null
        const selected = await api.sessions.selectModel({ sessionId: session.id as never, provider: model.provider, model: model.model })
        return selected.result.ok ? null : selected.result.error.message
      },
      selectModel: async (sessionId, model) => {
        const response = await api.sessions.selectModel({
          sessionId: sessionId as never, provider: model.provider, model: model.model,
        })
        return response.result.ok ? null : response.result.error.message
      },
      record: async (input) => {
        await fetch(SPACES_SELECT_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
          body: JSON.stringify(input),
        })
      },
      restartTerminal: async (sessionId, brainId) => { await terminalMode()?.restart(sessionId, brainId) },
    },
  )

  /** `@idealize/router`'s mutating routes; a shell without the router answers 404 and the row changes nothing. */
  const routerPost = async (path: string, body: unknown): Promise<void> => {
    await fetch(path, { method: 'POST', headers: { 'x-idealize-auth': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined)
  }

  const brainInjected = (): ComposerOverflowInjected => ({
    hooks: { brainSwitcher: brains.store },
    load: (session: BrainSessionSummary) => brains.load(session),
    select: (brainId: string, session: BrainSessionSummary) => brains.select(brainId, session),
    ...bar() === undefined
      ? {}
      : {
        addBrain: (space: SpaceId) => { bar()?.addBrain(space) },
        openBrains: () => { bar()?.show('models') },
      },
    router: {
      lock: async (sessionId, locked) => { await routerPost('/idealize/router/lock', { sessionId, locked }) },
      back: async (sessionId, to) => {
        await api.sessions.selectModel({ sessionId: sessionId as never, provider: to.provider, model: to.model })
        await routerPost('/idealize/router/reset', { sessionId })
        await routerPost('/idealize/router/lock', { sessionId, locked: true })
      },
      accept: async (sessionId, to) => {
        await api.sessions.selectModel({ sessionId: sessionId as never, provider: to.provider, model: to.model })
        await routerPost('/idealize/router/reset', { sessionId })
      },
    },
    // Read through ctx.get, as the probes above are: the block only unlocks
    // the control, so a shell without the conversation service loses nothing.
    composerBlock: (sessionId: SessionId) =>
      ((ctx as unknown as { get(name: string): unknown }).get('conversation') as ConversationBlocksLike | undefined)
        ?.blocks.storeFor(sessionId),
  })

  // The access seat, not the model seat: the brain choice and the project's
  // access mode are the two standing settings, and they share one three-dot
  // control so the tool row is left to the active space's own settings (JJ,
  // 9 Sep 2026). The composer hands its access chip in as `control`.
  ctx.slots.inject('conversation.input.access', () => ctx.slots.register({
    name: 'conversation.input.access',
    priority: -1,
    locale: NS,
    inject: brainInjected,
  }, ComposerOverflow))

  ctx.provide('activityPills', { face } satisfies ActivityPillsHost)
}
