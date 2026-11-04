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

import type { ReactNode } from 'react'
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
import { BrainChip } from './BrainChip.tsx'
import type { BrainChipInjected, ChipBrowserRequest, ChipDirectorySource, ComposerBlockSource, MediaBrainModel, ModelChoice, RouterAvailability } from './BrainChip.tsx'
import { BrainNotice } from './BrainNotice.tsx'
import { ComposerOverflow } from './ComposerOverflow.tsx'
import {
  BrainSwitcherController,
  type BrainAgent, type BrainSessionSummary, type TerminalLaunchTable,
} from './brain-switcher.ts'
import { en, zh, type ActivityKey } from './locales.ts'
import type { RouterActions } from './BrainChip.tsx'
import { routerNoteDefinition } from './router-node.ts'
import { routerNoteView } from './RouterNote.tsx'

export { BrainChip, brainLabel, brainPurpose, costKey, readableModel } from './BrainChip.tsx'
export { BrainNotice } from './BrainNotice.tsx'
export { ComposerOverflow } from './ComposerOverflow.tsx'
export { routerNoteDefinition } from './router-node.ts'
export { routerNoteText, routerNoteView } from './RouterNote.tsx'
export type { ComposerOverflowProps } from './ComposerOverflow.tsx'
export type { BrainChipInjected, BrainChipProps, ChipBrowserRequest, ComposerBlockSource, RouterActions, RouterAvailability } from './BrainChip.tsx'
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
  addKey(provider?: string): void
  editBrain(brainId: string): void
  renderChatModelBrowser(request: ChipBrowserRequest): ReactNode
}

/** The session's model directory registry (restated; ui-model-selection owns it). */
interface ModelDirectoriesLike {
  directoryFor(sessionId: SessionId): {
    store: ChipDirectorySource
    load(): Promise<unknown>
    select(selection: ModelChoice): Promise<unknown>
  }
}

/** The workspace service's share a new chat needs (restated; the client runtime owns it). */
interface WorkspacesLike {
  list: { getSnapshot(): { items: readonly { workspaceId: string; sessionIds: readonly string[] }[] } }
  connectWorkspace(workspaceId: string): Promise<SessionId>
  noteSessionConfigured(sessionId: SessionId): () => void
}

/** The media settings table a space's generation model is read from. */
const MEDIA_PRESET: Partial<Record<SpaceId, string>> = { gallery: 'images', soundstage: 'sound', motion: 'motion' }

/** The conversation service's composer blocks (restated; ui-conversation owns it). */
interface ConversationBlocksLike {
  blocks: { storeFor(sessionId: SessionId): ComposerBlockSource }
}

/** What a chip with no model directory reads; it renders nothing. */
const EMPTY_MODELS = { current: null, groups: [], status: 'idle' }
const EMPTY_DIRECTORY: ChipDirectorySource = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_MODELS,
}

/** Required services. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'sessions']

/**
 * Client plugin body: the composer's brain switcher and the `activityPills` service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'idealize-activity: dictionaries')

  // The router's line in the transcript. Scoped, so a surface without the
  // conversation (the Askbar's frame) still gets the switcher.
  ctx.inject(['conversationEvents'], (conversationCtx) => {
    conversationCtx.conversationEvents.register(routerNoteDefinition)
  })
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'router-note',
    locale: 'conversation',
  }, routerNoteView(ctx.locale.bind(NS) as Parameters<typeof routerNoteView>[0])))

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

  const models = (): ModelDirectoriesLike | undefined => probe<ModelDirectoriesLike>('modelDirectories', 'directoryFor')

  const routerActions: RouterActions = {
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
  }

  /** Whether auto-switch can run: on, with OpenRouter connected for the reading and a second model to move to. */
  const routerState = async (): Promise<RouterAvailability | null> => {
    const response = await fetch('/idealize/router/state').catch(() => undefined)
    if (response === undefined || !response.ok) return null
    const state = await response.json() as {
      settings: { enabled: boolean; useJev: boolean; offBrains: readonly string[] }
      jev: { keyed: boolean }
      candidates: number
    }
    const off = !state.settings.enabled || !state.settings.useJev
    const blockedBy = off ? 'off' : !state.jev.keyed ? 'account' : state.candidates < 2 ? 'model' : undefined
    return {
      canRun: blockedBy === undefined,
      ...blockedBy === undefined ? {} : { blockedBy },
      offBrains: state.settings.offBrains,
    }
  }

  /** The routes a person's plan pays for: signed-in subscriptions. OpenRouter takes a sign-in too, and still bills by use. */
  const planRoutes = async (): Promise<ReadonlySet<string>> => {
    const response = await fetch('/idealize/models/state').catch(() => undefined)
    if (response === undefined || !response.ok) return new Set()
    const { providers } = await response.json() as { providers: readonly { provider: string; auth?: string; connected?: boolean }[] }
    return new Set(providers.filter(row => row.auth === 'oauth' && row.connected === true && row.provider !== 'openrouter').map(row => row.provider))
  }

  /** A media space's generation model, named as the Brains pane names it. */
  const mediaModel = async (space: SpaceId): Promise<MediaBrainModel | null> => {
    const preset = MEDIA_PRESET[space]
    if (preset === undefined) return null
    const [mediaResponse, servicesResponse] = await Promise.all([
      fetch('/idealize/brains/media').catch(() => undefined),
      fetch('/idealize/brains/services').catch(() => undefined),
    ])
    if (mediaResponse === undefined || !mediaResponse.ok) return null
    const { presets } = await mediaResponse.json() as {
      presets: readonly {
        id: string
        model: { backend: string; model: string } | null
        candidates: readonly { backend: string; model: { id?: string; name?: string } | string }[]
      }[]
    }
    const row = presets.find(entry => entry.id === preset)
    if (row === undefined) return null
    const listed = servicesResponse?.ok === true
      ? (await servicesResponse.json() as { services: readonly { id: string; name: string; connected?: boolean }[] }).services
      : []
    // With nothing chosen a generation falls to a compatible model, and only a
    // connected service can run it: the catalogues of the others are public.
    const open = row.candidates.find(entry => !listed.some(service => service.id === entry.backend && service.connected !== true))
    const chosen = row.model ?? (open === undefined
      ? undefined
      : { backend: open.backend, model: typeof open.model === 'string' ? open.model : open.model.id ?? '' })
    if (chosen === undefined) return null
    const candidate = row.candidates.find(entry => entry.backend === chosen.backend
      && (typeof entry.model === 'string' ? entry.model : entry.model.id) === chosen.model)
    return {
      name: (typeof candidate?.model === 'object' ? candidate.model.name : undefined) ?? chosen.model,
      service: listed.find(entry => entry.id === chosen.backend)?.name ?? chosen.backend,
    }
  }

  /** A new chat in the same project, on the chosen brain. */
  const startChat = async (brainId: string, space: SpaceId, sessionId: string): Promise<void> => {
    const workspaces = probe<WorkspacesLike>('workspaces', 'connectWorkspace')
    const workspace = workspaces?.list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId))
    if (workspaces === undefined || workspace === undefined) return
    const next = await workspaces.connectWorkspace(workspace.workspaceId)
    workspaces.noteSessionConfigured(next)
    sessions.open(next)
    const session: BrainSessionSummary = { id: next, blank: true, space, brain: brainId }
    await brains.load(session)
    await brains.select(brainId, session)
  }

  const chipInjected = (sessionId: SessionId): BrainChipInjected => {
    const directory = models()?.directoryFor(sessionId)
    const available = directory !== undefined && sessions.subagentAddress(sessionId) === undefined
    const shell = bar()
    return {
      hooks: { brainSwitcher: brains.store },
      load: (session: BrainSessionSummary) => brains.load(session),
      select: (brainId: string, session: BrainSessionSummary) => brains.select(brainId, session),
      available,
      directory: directory?.store ?? EMPTY_DIRECTORY,
      loadModels: () => { if (available) directory.load().catch(() => { /* surfaced on the store */ }) },
      selectModel: (choice: ModelChoice) => available
        ? directory.select(choice).then(() => true, () => false)
        : Promise.resolve(false),
      // Read through ctx.get, as the probes above are: the block only unlocks
      // the chip, so a shell without the conversation service loses nothing.
      composerBlock: (id: string) =>
        ((ctx as unknown as { get(name: string): unknown }).get('conversation') as ConversationBlocksLike | undefined)
          ?.blocks.storeFor(id as SessionId),
      ...shell === undefined
        ? {}
        : {
          addBrain: (space: SpaceId) => { bar()?.addBrain(space) },
          openBrains: () => { bar()?.show('models') },
          addKey: (provider?: string) => { bar()?.addKey(provider) },
          editBrain: (brainId: string) => { bar()?.editBrain(brainId) },
          renderModelBrowser: (request: ChipBrowserRequest) => bar()?.renderChatModelBrowser(request),
        },
      // The sign-in surface is a page of its own, opened the way the Brains pane opens it.
      signIn: () => { window.open('/idealize/signin', '_blank', 'noopener') },
      startChat,
      router: routerActions,
      routerState,
      planRoutes,
      mediaModel,
    }
  }

  // The brain decides the model, so the brain and the model share one chip on
  // the model seat (JJ, 4 Nov 2026), shadowing ui-model-selection's dropdown.
  // The /model command stays for the odd manual pick.
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register({
    name: 'conversation.input.model',
    priority: -1,
    locale: NS,
    inject: chipInjected,
  }, BrainChip))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'brain-notice',
    locale: NS,
    inject: chipInjected,
  }, BrainNotice))

  // The access seat holds the project's access mode alone since the chip took
  // the brain. The composer hands its access chip in as `control`.
  ctx.slots.inject('conversation.input.access', () => ctx.slots.register({
    name: 'conversation.input.access',
    priority: -1,
    locale: NS,
  }, ComposerOverflow))

  ctx.provide('activityPills', { face } satisfies ActivityPillsHost)
}
