/**
 * IDEalize's model router. Each message a person sends in a chat is read for
 * the kind of work it asks for by Jev, through the user's own OpenRouter key.
 * When Jev gives no reading (no key, a timeout, an error) the chat keeps its
 * model: a hang never costs the user more than Jev's limit, and the router
 * never moves a chat on a guess (JJ, 21 Sep 2026). Every connected model is scored for
 * that work under the user's cost, speed and intelligence weights, and a
 * clearly better model takes the turn. The switch happens in the agent's
 * `agent/request` waterfall, which replaces one call's provider and model for
 * one chat; the app-wide default model is never touched.
 *
 * Only the latest message leaves the machine, with the brain's name and
 * instructions. No history, files or images (JJ, 21 Sep 2026).
 *
 * Each brain carries its own criteria (how readily its chats move, and the
 * three weights), set in its sheet. The app-wide values serve a chat that runs
 * no brain. A turn that runs on free tokens sends the brain's weights to the
 * engine in a header, so the engine picks its provider on the same criteria.
 *
 * Three things stop switching: a chat's lock, a brain listed in `offBrains`,
 * and `enabled: false`. Terminal chats run a command-line agent the router
 * cannot reach, and the generating spaces choose their own models.
 *
 * When a chat's own model cannot answer (its sign-in or key went, its credit ran
 * out, or it stayed busy through the retries), the router hands the turn to the
 * best other connected model instead of letting it fail. It needs no reading from
 * Jev to do so: Jev's limit protects a chat that works, and this turn has already failed.
 *
 * HTTP surface (loopback-fenced; mutations demand the header):
 * - GET  /idealize/router/state — settings, the weights it reads, whether Jev is reachable, the last Jev failure, and the capability table.
 * - POST /idealize/router/settings — any of {enabled, aggressiveness, preferFree, showRationale, useJev, offBrains}.
 * - POST /idealize/router/brain — {brain, aggressiveness?, cost?, speed?, intelligence?}: one brain's own criteria.
 * - POST /idealize/router/lock — {sessionId, locked}.
 * - POST /idealize/router/reset — {sessionId}: the user took the model back; the earlier switch no longer holds.
 * - GET  /idealize/router/log?limit=n — the newest decisions, newest first.
 * - GET  /idealize/router/ratings — the tag list per kind of model and every rating the person holds.
 * - POST /idealize/router/ratings — {kind, provider, model, tag, stars (1 to 5, or null to clear), label?}.
 * - GET  /idealize/router/rate-target?sessionId= — the model behind the chat's last answer and the tag its line opens on.
 * - GET  /idealize/router/offer?sessionId= — after a dislike: the two models to try, and what both runs should cost.
 * - POST /idealize/router/compare — {sessionId, alternatives}: run them; the steps land in the log as `idealize/router-compare`.
 * - POST /idealize/router/pick — {sessionId, id, index}: keep an alternative (or -1, the first answer).
 *
 * The generating spaces: when the person has starred a media model, each
 * generation's prompt is read as one kind of work, and the call moves to the
 * model they rated highest for it (`generation/choose-model`). A model kept
 * after a dislike serves the rest of that chat's generations of its kind.
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, Message } from '@deepseek-ai/dsh-llm'
import type { CallId } from '@deepseek-ai/dsh-llm/brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { createFreetokensProbe, effectivePrices, readOpenRouterPriceCache } from '@idealize/models'
import type { TokenPriceTable } from '@idealize/models'
import { recordedKeyEnv, shippedTokenPrices } from '@idealize/services'
import { foldBrainRecord, resolveSessionSpace } from '@idealize/spaces'
import type { ArtefactRecord } from '@idealize/artefacts'
import { GENERATION_SCHEMA_VERSION, MEDIA_PRESETS } from '@idealize/generate'
import type { GenCatalogEntry, GenerationRequest, GenerationResult } from '@idealize/generate'
// Type-only: the `generation/choose-model` Events merge.
import type {} from '@idealize/gen-tools'

import { alternativesFor } from './alternatives.ts'
import { ANSWER_IN_TEXT, askBefore, askOf, compareCost, foldCompare, foldMediaKept, keptNote, lastReply } from './compare.ts'

import { candidatesFrom, FREE_PROVIDER } from './candidates.ts'
import { criteriaFor, engineWeights, ROUTING_HEADER, routingHeaderValue, SHIPPED_CRITERIA } from './criteria.ts'
import type { BrainCriteria, Criteria } from './criteria.ts'
import type { ConnectedRoute, RouteAuth } from './candidates.ts'
import type { Aggressiveness, Candidate, Weights } from './decide.ts'
import { askJev, isLocalModelRoute, jevAddress, JEV_TIMEOUT_MS, JEV_URL, requestFor } from './jev.ts'
import type { JevFailure } from './jev.ts'
import { appendLog, entryFor, readLog } from './log.ts'
import { checkReply, saidItCannot } from './reply-check.ts'
import { foldLocked, foldRouted, routerProjectionDefinition } from './projection.ts'
import {
  decideMedia, hasStarsFor, MEDIA_CONFIDENCE, mediaAlternativesFor, mediaCost, mediaTagFor, PRESET_KIND, readableTags, readPrompt,
} from './media.ts'
import type { CompareKind, RoutedModel, RouterCompareEventData } from './projection-types.ts'
import {
  addMark, isRatingKind, isStars, isTag, RATING_TAGS, ratingsOf, readRatings, setStars, standing, TASK_TAG, updateRatings,
} from './ratings.ts'
import type { RatingKind, RatingsFile } from './ratings.ts'
import { forgetGatewayRefusals, noteRefusal, readRefusals, REFUSAL_SPAN, refusalCause, routeKey, sitsOut } from './refused.ts'
import type { Refusals } from './refused.ts'
import { routeTurn } from './route.ts'
import { canStepIn, chooseStandIn, FREE_LABEL, MAX_STAND_INS, stepInRationale } from './step-in.ts'
import { SHIPPED_SCORES } from './score-table.ts'
import type { ScoreRow } from './score-table.ts'
import { readLocally } from './tasks.ts'
import type { TaskReading } from './tasks.ts'

export { candidatesFrom } from './candidates.ts'
export { criteriaFor, engineWeights, ROUTING_HEADER, routingHeaderValue, SHIPPED_CRITERIA } from './criteria.ts'
export type { BrainCriteria, Criteria, EngineWeights } from './criteria.ts'
export { decide, PRESETS, rationaleFor, score } from './decide.ts'
export type { Aggressiveness, Candidate, Decision, Scored, StayReason, Weights } from './decide.ts'
export { askJev, requestFor } from './jev.ts'
export { currentModel, foldLocked, foldRouted, routerProjectionDefinition } from './projection.ts'
export type { RoutedModel, RouterEventData, RouterLockEventData, RouterProjection } from './projection-types.ts'
export { routeTurn } from './route.ts'
export { canStepIn, chooseStandIn, stepInRationale } from './step-in.ts'
export { SHIPPED_SCORES } from './score-table.ts'
export type { ScoreRow } from './score-table.ts'
export { alternativesFor } from './alternatives.ts'
export { askBefore, compareCost, foldCompare, foldMediaKept, keptNote, lastReply } from './compare.ts'
export { decideMedia, hasStarsFor, mediaAlternativesFor, mediaCost, mediaTagFor, readableTags } from './media.ts'
export { addMark, RATING_TAGS, ratingKey, ratingsOf, readRatings, setStars, standing, TASK_TAG, updateRatings } from './ratings.ts'
export type { RatedModel, RatingKind, RatingsFile, Stars, TagRating } from './ratings.ts'
export { readLocally, TASKS } from './tasks.ts'
export type { TaskReading, TaskType } from './tasks.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'idealize-router'

const NS = settingsNamespace('idealize-router')
const MODELS_NS = settingsNamespace('idealize-models')
const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY'
const LLM_SECTION = settingsNamespace('llm-pi-ai')
/** The user's own capability rows, read over the shipped table. */
const USER_SCORES_FILE = 'router-scores.json'
/** Routes and their model lists change rarely; a turn does not wait on them twice a minute. */
const CANDIDATES_FRESH_MS = 60_000
/** The longest one alternative may take over a chat answer. */
const COMPARE_CHAT_MS = 180_000
/** The longest one alternative may take over a picture, clip or sound. */
const COMPARE_MEDIA_MS = 600_000
/** The space a chat runs in, as the kind of model its answers come from. */
const SPACE_KIND: Readonly<Record<string, CompareKind>> = { chat: 'chat', gallery: 'image', motion: 'video', soundstage: 'audio' }
/** The media preset each kind of model serves. */
const KIND_PRESET: Readonly<Record<Exclude<RatingKind, 'chat'>, string>> = { image: 'images', video: 'motion', audio: 'sound' }

export interface RouterConfig {
  /** Off: every chat stays on the model it has. */
  enabled?: boolean
  /** How sure and how much better a model must be, and how long after the last switch. */
  aggressiveness?: Aggressiveness
  /** On: the router moves a chat only to a model that costs nothing more, and offers a paid one for the user to accept. */
  preferFree?: boolean
  /** On: the composer's badge carries the sentence of why. */
  showRationale?: boolean
  /** Off: keyword rules on this machine read every message and nothing leaves it. Config only; the app offers no control for it. */
  useJev?: boolean
  /** Brains whose chats are never routed. */
  offBrains?: string[]
  /** Each brain's own criteria, by brain id; a brain without an entry starts from its shipped row, then the app-wide values. */
  brains?: Record<string, BrainCriteria>
  /** OpenRouter marks the Decisions endpoint alpha, so its address is config. An installed app ignores it (see {@link jevAddress}). */
  jevUrl?: string
  /** The longest a turn waits on Jev, in milliseconds. */
  jevTimeoutMs?: number
  /** Off: a finished reply is not read, so a model that says the work is beyond it gets no offer of another. */
  replyCheck?: boolean
}

export const Config: z<RouterConfig> = z.object({
  enabled: z.boolean().default(true),
  aggressiveness: z.union(['conservative', 'balanced', 'aggressive']).default('balanced'),
  preferFree: z.boolean().default(true),
  showRationale: z.boolean().default(true),
  useJev: z.boolean().default(true),
  offBrains: z.array(z.string()).default([]),
  brains: z.dict(z.object({
    aggressiveness: z.union(['conservative', 'balanced', 'aggressive']),
    cost: z.number(),
    speed: z.number(),
    intelligence: z.number(),
  })).default({}),
  jevUrl: z.string().default(JEV_URL),
  jevTimeoutMs: z.natural().default(JEV_TIMEOUT_MS),
  replyCheck: z.boolean().default(true),
})

/** The subscription sign-in service's face, as far as this plugin reads it. */
interface OAuthFace {
  status?(): Promise<{ id: string; stored: boolean; keyless?: boolean }[]>
  store?: { read(providerId: string): Promise<{ access?: unknown } | undefined> }
}

/** What `agent/pre-step` saw of the turn, held until its first request. */
interface PendingTurn { turn: number; message: string; hasImages: boolean }
/** What a turn was routed to, held for the turn's later steps and its fallback. */
interface RoutedTurn {
  turn: number
  use: { provider: string; model: string }
  resolved: { provider: string; model: string }
  fellBack: boolean
  /** The models this turn has already failed on. */
  tried?: ReadonlyArray<{ provider: string; model: string }>
  /** How many models have stood in for the chat's own this turn. */
  standIns?: number
}

function refuse(req: IncomingMessage, res: ServerResponse, mutating: boolean): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (mutating && req.headers['x-idealize-auth'] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
    return true
  }
  return false
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
}

const sameModel = (a: { provider: string; model: string }, b: { provider: string; model: string }): boolean =>
  a.provider === b.provider && a.model === b.model

/** The generation service's face, as far as this plugin reads it. */
interface GenerationFace {
  compatible(required: readonly unknown[]): GenCatalogEntry[]
  /** The backends that take a key, and whether one is stored. */
  credentials?(): { backend: string; connected: boolean }[]
  generate(request: GenerationRequest, onProgress?: undefined, signal?: AbortSignal): Promise<GenerationResult>
}

/** The artefact store's face, as far as this plugin reads it. */
interface ArtefactsFace {
  create(request: {
    session: Session
    mediaType: string
    bytes: Uint8Array
    settings: ArtefactRecord['settings']
    sourceTask: { turnSeq: number; callId: CallId; toolName: string }
    provenance: ArtefactRecord['provenance']
  }): Promise<ArtefactRecord>
}

/**
 * The catalogue entries a person can run now: a backend that takes a key and
 * has none stored is left out, so an offer never names a model that cannot answer.
 */
function runnable(service: GenerationFace | undefined, entries: readonly GenCatalogEntry[]): GenCatalogEntry[] {
  const unkeyed = new Set((service?.credentials?.() ?? []).filter(row => !row.connected).map(row => row.backend))
  return entries.filter(entry => !unkeyed.has(entry.backend))
}

/** The last picture, clip or sound the chat made. */
function lastArtefact(events: readonly SessionEvent[]): ArtefactRecord | undefined {
  const created = events.findLast(event => event.type === 'artefact/created')
  return created?.type === 'artefact/created' ? created.data.record : undefined
}

/** The kind of model that makes one media type. */
function kindOfMedia(mediaType: string): Exclude<RatingKind, 'chat'> | undefined {
  const top = mediaType.split('/')[0]
  return top === 'image' || top === 'video' || top === 'audio' ? top : undefined
}

/** The tokens the chat's last answer read: the closest figure the log holds to what the next model must take in. */
function contextTokensOf(events: readonly SessionEvent[]): number | undefined {
  const last = events.findLast(event => event.type === 'assistant/message' && event.data.usage !== undefined)
  if (last?.type !== 'assistant/message' || last.data.usage === undefined) return undefined
  const usage = last.data.usage
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + usage.outputTokens
}

/** The user's rows over the shipped ones; a missing or broken file reads as none. */
async function scoreTable(home: string, onUnreadable?: () => void): Promise<readonly ScoreRow[]> {
  let text: string
  try {
    text = await readFile(join(home, USER_SCORES_FILE), 'utf8')
  } catch {
    // No file: the user has written no rows.
    return SHIPPED_SCORES
  }
  try {
    const rows: unknown = JSON.parse(text)
    if (!Array.isArray(rows)) {
      onUnreadable?.()
      return SHIPPED_SCORES
    }
    const usable = rows.filter((row): row is ScoreRow =>
      typeof row === 'object' && row !== null && typeof (row as ScoreRow).pattern === 'string'
      && typeof (row as ScoreRow).family === 'string' && typeof (row as ScoreRow).speed === 'number'
      && typeof (row as ScoreRow).scores === 'object' && (row as ScoreRow).scores !== null)
    return [...usable, ...SHIPPED_SCORES]
  } catch {
    onUnreadable?.()
    return SHIPPED_SCORES
  }
}

export function apply(ctx: Context, config: RouterConfig = {}): void {
  let current: () => RouterConfig = () => ({ ...config })
  let bestConnected: () => Promise<{ provider: string; model: string } | undefined> = () => Promise.resolve(undefined)
  let freeEmptyNow: () => Promise<boolean> = () => Promise.resolve(false)
  // The auto policy reads this through ctx.get(), since the models package sits below the router.
  ctx.provide('idealizeRouter', { bestConnected: () => bestConnected(), freeEmpty: () => freeEmptyNow() })
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source: () => RouterConfig) => {
      current = source
    },
    onChange: () => {},
  })

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(routerProjectionDefinition)
  })

  ctx.inject(['llm', 'settings', 'credentials'], (routeCtx) => {
    const home = resolveDshHome()
    const pending = new WeakMap<Agent, PendingTurn>()
    const routedTurns = new WeakMap<Agent, RoutedTurn>()
    let lastJevFailure: { failure: JevFailure; at: string } | undefined
    let cached: { at: number; candidates: Candidate[] } | undefined
    const freetokensFacts = createFreetokensProbe(routeCtx)
    /** Whether the free-tokens engine held no usable key at the last read of the routes. */
    let freeEmpty = false
    const isFreeEmpty = (): boolean => freeEmpty
    let refusals: Refusals | undefined
    /** The connected key gateway the refusals were last checked against. */
    let gatewaySeen: string | undefined
    /** The ratings as last read or written; every write goes through {@link rate}. */
    let ratings: RatingsFile | undefined
    const currentRatings = async (): Promise<RatingsFile> => (ratings ??= await readRatings(home))
    /** The kind of work the router read for each chat's latest turn, for the heart's line. */
    const readings = new Map<string, { turn: number; reading: TaskReading }>()
    /** The tag the router read for each chat's latest generation, by preset. */
    const mediaReadings = new Map<string, Map<string, string>>()
    /** Chats with a comparison running, so a second tap does not pay twice. */
    const comparing = new Set<string>()
    const rate = async (change: (file: RatingsFile) => void): Promise<RatingsFile> => {
      ratings = await updateRatings(home, change)
      return ratings
    }

    /** A stored key first; a person who signed in to OpenRouter holds a key in the sign-in store, under `access`. */
    const openRouterKey = async (): Promise<string | undefined> => {
      const stored = (await routeCtx.credentials.resolve(credentialRef(OPENROUTER_KEY_ENV)).catch(() => undefined))?.value
      if (stored !== undefined && stored !== '') return stored
      const signedIn = await (routeCtx.get('idealizeOAuth') as OAuthFace | undefined)?.store?.read('openrouter').catch(() => undefined)
      return typeof signedIn?.access === 'string' && signedIn.access !== '' ? signedIn.access : undefined
    }

    /**
     * Where Jev is asked and with which key: the person's own OpenRouter key at OpenRouter, else a key gateway that
     * fronts OpenRouter. The gateway is the person's own setting, so it is used as given.
     */
    const jevTarget = async (configuredUrl: string | undefined): Promise<{ key: string | undefined; url: string }> => {
      const key = await openRouterKey()
      if (key !== undefined) return { key, url: jevAddress(configuredUrl) }
      const gateway = await (routeCtx.get('idealizeGateway') as { decisions?: () => Promise<{ url: string; key: string } | undefined> } | undefined)
        ?.decisions?.().catch(() => undefined)
      return gateway ?? { key: undefined, url: jevAddress(configuredUrl) }
    }

    const weights = (): Weights => {
      const models = routeCtx.settings.get(MODELS_NS) as Partial<Weights> | undefined
      return { cost: models?.cost ?? 34, speed: models?.speed ?? 33, intelligence: models?.intelligence ?? 33 }
    }

    /** The criteria a brain's turn is decided under; the app-wide values for a chat without one. */
    const criteria = (brain: string | undefined): Criteria => {
      const settings = current()
      return criteriaFor(settings.brains, brain, { aggressiveness: settings.aggressiveness ?? 'balanced', weights: weights() })
    }

    /**
     * The routes that can answer now, as the Brains pane judges them: a stored key,
     * a signed-in subscription, or the free engine with models registered.
     */
    const connectedRoutes = async (): Promise<ConnectedRoute[]> => {
      const read = (ns: Parameters<typeof routeCtx.settings.get>[0]): unknown => routeCtx.settings.get(ns)
      const oauth = routeCtx.get('idealizeOAuth') as OAuthFace | undefined
      const subs = oauth?.status === undefined ? [] : await oauth.status().catch(() => [])
      const routes = await Promise.all(routeCtx.llm.listConfigurableProviders().map(async (entry): Promise<ConnectedRoute | undefined> => {
        // Read where the route's own adapter keeps it: DeepSeek's key lives in
        // llm-deepseek, not under pi-ai's providers (JJ, 30 Oct 2026).
        const apiKeyEnv = recordedKeyEnv(read, entry)
        const sub = subs.find(row => row.id === entry.provider)
        const auth: RouteAuth = entry.provider === FREE_PROVIDER
          ? 'free'
          : sub?.keyless === true || (typeof apiKeyEnv !== 'string' && sub !== undefined) ? 'oauth' : 'apiKey'
        const connected = auth === 'oauth'
          ? sub?.stored === true
          : typeof apiKeyEnv === 'string' && (await routeCtx.credentials.resolve(credentialRef(apiKeyEnv)).catch(() => undefined)) !== undefined
        if (!connected) return undefined
        const models = await routeCtx.llm.listModels(entry.provider).catch(() => [])
        return { provider: entry.provider, auth, models }
      }))
      const connected = routes.filter((route): route is ConnectedRoute => route !== undefined && route.models.length > 0)
      if (!connected.some(route => route.provider === FREE_PROVIDER)) return connected
      // The engine counts as connected with no key to send upstream, and then refuses every call.
      freeEmpty = (await freetokensFacts().catch(() => undefined))?.usableKeys === 0
      return freeEmpty ? connected.filter(route => route.provider !== FREE_PROVIDER) : connected
    }

    const candidates = async (): Promise<Candidate[]> => {
      if (cached !== undefined && Date.now() - cached.at < CANDIDATES_FRESH_MS) return cached.candidates
      const routes = await connectedRoutes()
      const user = (routeCtx.settings.get(MODELS_NS) as { tokenPrices?: TokenPriceTable } | undefined)?.tokenPrices ?? {}
      const shipped: TokenPriceTable = {}
      // A key gateway's route reads the prices of the company it fronts.
      for (const provider of new Set(routes.flatMap(route => [route.provider, route.provider.replace(/^gateway-/u, '')]))) {
        const prices = shippedTokenPrices(provider)
        if (prices !== undefined) shipped[provider] = prices
      }
      const directory = readOpenRouterPriceCache(home)
      const prices = effectivePrices(user, directory?.prices, shipped)
      const live = directory === undefined
        ? undefined
        : new Set([...Object.keys(directory.prices), ...Object.keys(directory.details ?? {})])
      cached = { at: Date.now(), candidates: candidatesFrom(routes, prices, live) }
      return cached.candidates
    }

    /** The candidates, less the models that refused a routed turn lately. */
    const usable = async (): Promise<Candidate[]> => {
      refusals ??= await readRefusals(home)
      const live = refusals
      // A gateway at a new address or under a new key starts with a clean record.
      const gateway = (routeCtx.get('idealizeGateway') as { status?: () => { connected?: boolean; address?: string; last4?: string } } | undefined)?.status?.()
      const identity = gateway?.connected === true && gateway.address !== undefined ? `${gateway.address}|${gateway.last4 ?? ''}` : undefined
      if (identity !== undefined && identity !== gatewaySeen) {
        gatewaySeen = identity
        await forgetGatewayRefusals(home, live, identity)
      }
      const now = Date.now()
      return (await candidates()).filter(candidate => !sitsOut(live, candidate, now))
    }

    /** Whether this chat is one the router routes this turn. */
    const localRoute = (provider: string): boolean => {
      const section = routeCtx.settings.get(LLM_SECTION) as { providers?: Record<string, { baseURL?: unknown } | undefined> } | undefined
      return isLocalModelRoute(provider, section?.providers?.[provider]?.baseURL)
    }

    const routable = (agent: Agent): boolean => {
      const settings = current()
      if (settings.enabled === false) return false
      const events = agent.session.events
      if (resolveSessionSpace(agent.session) !== 'chat' || foldLocked(events)) return false
      const brain = foldBrainRecord(events)?.brain
      return brain === undefined || !(settings.offBrains ?? []).includes(brain)
    }

    /** The name the person knows a model by: the router's own list, then the route's model list, then its id. */
    const labelOf = async (model: { provider: string; model: string }): Promise<string> => {
      // The route leaves the list when its engine is empty, and its model id means nothing to the person.
      if (model.provider === FREE_PROVIDER) return FREE_LABEL
      const known = (await candidates()).find(candidate => sameModel(candidate, model))?.label
      if (known !== undefined) return known
      const listed = (await routeCtx.llm.listModels(model.provider).catch(() => [])).find(one => one.id === model.model)
      return listed?.name ?? model.model
    }

    /**
     * Hand a failed turn to another model, or offer one when the choice is the person's.
     * @returns true when another model takes the turn.
     */
    const stepIn = async (agent: Agent, routed: RoutedTurn, failure: { code: string; message: string }): Promise<boolean> => {
      const standIns = routed.standIns ?? 0
      const failed = routed.use
      const tried = [...routed.tried ?? [], failed]
      // A stand-in that failed sits out like a routed model that failed, unless it only refused this chat's history.
      // The last stand-in a turn may try is noted too, or the next turn opens on the same dead model.
      if (standIns > 0 && failure.code !== 'INVALID_REQUEST') {
        refusals ??= await readRefusals(home)
        await noteRefusal(home, refusals, failed, refusalCause(failure.code))
      }
      if (standIns >= MAX_STAND_INS) return false
      // A sign-in or key that went is a change the cached route list has not seen.
      cached = undefined
      const settings = current()
      const events = agent.session.events
      const session = String(agent.session.header.id)
      const record = foldBrainRecord(events)
      const read = readings.get(session)
      const reading = read?.turn === routed.turn ? read.reading : readLocally('', record?.brain)
      const file = await currentRatings()
      const choice = await chooseStandIn({
        failed,
        code: failure.code,
        tried,
        candidates: await usable(),
        reading,
        weights: criteria(record?.brain).weights,
        preferFree: settings.preferFree ?? true,
        contextTokens: contextTokensOf(events),
        hasImages: events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image')),
        nothingSent: !events.some(event => event.type === 'assistant/message'),
        table: await scoreTable(home),
        standingOf: candidate => standing(file, { kind: 'chat', model: candidate.model }, TASK_TAG[reading.task]),
      }, async candidate => (await routeCtx.llm.resolveModelInfo(candidate.provider, candidate.model)).context?.contextWindow)
      if (choice.kind === 'none') {
        routeCtx.logger.warn(`idealize-router: ${routeKey(failed)} failed (${failure.code}) and no other connected model can take the turn`)
        return false
      }
      const at = new Date().toISOString()
      const to = { provider: choice.to.provider, model: choice.to.model, label: choice.to.label }
      const rationale = stepInRationale(await labelOf(failed), failure.code, choice)
      agent.session.append('idealize/router', {
        outcome: choice.kind === 'use' ? 'switched' : 'offer',
        at,
        // Named from the chat's own model, whichever stand-in just failed: a switch holds only while its `from` is what the host resolves.
        from: { ...routed.resolved, label: await labelOf(routed.resolved) },
        to,
        task: reading.task,
        ...choice.kind === 'offer' ? { reason: choice.reason } : {},
        ...settings.showRationale === false ? {} : { rationale },
      }, { ignorable: true })
      void appendLog(home, {
        at, session, brain: record?.brain, reading,
        from: routeKey(failed), to: routeKey(choice.kind === 'use' ? choice.to : failed),
        switched: choice.kind === 'use',
        ...choice.kind === 'offer' ? { stayed: choice.reason, recommended: routeKey(choice.to) } : {},
        improvement: 0, switchConfidence: Number(reading.confidence.toFixed(3)), rationale,
      })
      routeCtx.logger.warn(`idealize-router: ${routeKey(failed)} failed (${failure.code}: ${failure.message}); ${choice.kind === 'use' ? `${routeKey(choice.to)} takes the turn` : `${routeKey(choice.to)} is offered (${choice.reason})`}`)
      if (choice.kind !== 'use') return false
      routedTurns.set(agent, { ...routed, use: { provider: to.provider, model: to.model }, fellBack: true, tried, standIns: standIns + 1 })
      return true
    }

    freeEmptyNow = async () => {
      await candidates()
      return isFreeEmpty()
    }

    /** The model Auto falls to when the free tier and the subscription cannot answer. */
    bestConnected = async () => {
      // A key saved a moment ago is why this is being asked.
      cached = undefined
      const choice = await chooseStandIn({
        failed: { provider: FREE_PROVIDER, model: 'auto' },
        code: 'MISSING_CREDENTIAL',
        tried: [],
        candidates: await usable(),
        reading: readLocally(''),
        weights: weights(),
        preferFree: current().preferFree ?? true,
        hasImages: false,
        table: await scoreTable(home),
      }, () => Promise.resolve(undefined))
      return choice.kind === 'use' ? { provider: choice.to.provider, model: choice.to.model } : undefined
    }

    /**
     * Whether the router may rescue this chat's turn when its model cannot answer. An image, sound or video chat is
     * left alone by ordinary routing, yet its own conversation still runs on a model and fails the same way. A
     * terminal runs a command-line agent the router cannot reach.
     */
    const rescuable = (agent: Agent): boolean => {
      const settings = current()
      if (settings.enabled === false) return false
      const events = agent.session.events
      if (resolveSessionSpace(agent.session) === 'terminal' || foldLocked(events)) return false
      const brain = foldBrainRecord(events)?.brain
      return brain === undefined || !(settings.offBrains ?? []).includes(brain)
    }

    routeCtx.on('agent/pre-step', async ({ agent, turn }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      // A brief another chat wrote is what this turn was asked, so it is routed as the
      // person's words would be, on the brief alone.
      const { mine, message } = askOf(decision.messages)
      if (message !== '') {
        const hasImages = agent.session.events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image'))
          || mine.some(item => item.content.some(block => block.type === 'image'))
        pending.set(agent, { turn, message, hasImages })
      }
      return decision
    })

    // Prepended, so this listener wraps the host's own model selection and its answer is the one the call runs on.
    routeCtx.on('agent/request', async ({ agent, turn }, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const on = (use: { provider: string; model: string }): LlmCallConfig => {
        if (sameModel(use, resolved)) return resolved
        // An effort belongs to the model it was chosen for; the new model runs at its own default.
        const { reasoningEffort: _effort, ...rest } = resolved
        return { ...rest, provider: use.provider, model: use.model }
      }
      try {
        const earlier = routedTurns.get(agent)
        if (earlier !== undefined && earlier.turn === turn) return on(earlier.use)
        // A person who picked a model on their own computer did not ask for
        // their message to leave it, so the router neither reads nor moves it.
        if (localRoute(resolved.provider)) {
          pending.delete(agent)
          routedTurns.set(agent, { turn, use: resolved, resolved, fellBack: false })
          return resolved
        }
        const { routed, lastSwitchAt } = foldRouted(agent.session.events)
        // Two chats cannot reach their model at all and move before the request, so the person never sees the failure:
        // one on Free tokens with no key in the engine, and one whose route nothing serves, as OpenRouter on an install
        // that connected another company's key (a route with no adapter throws past the request-error listener).
        if (rescuable(agent) && !(routed !== undefined && sameModel(resolved, routed.from))) {
          let cause: { code: string; message: string } | undefined
          if (resolved.provider === FREE_PROVIDER) {
            await candidates()
            // Read after the await above, which is what can change it.
            if (isFreeEmpty()) cause = { code: 'MISSING_CREDENTIAL', message: 'the free-tokens engine holds no usable key' }
          } else if (!routeCtx.llm.listProviders().some(provider => provider.id === resolved.provider)) {
            cause = { code: 'NO_ADAPTER', message: `nothing serves the route ${resolved.provider}` }
          } else if (!routable(agent) && agent.session.events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image'))) {
            // A chat holding pictures on a model stated to take none would fail or answer blind. Ordinary routing moves
            // a chat that holds them (decide's sight rule); an image, sound or video chat, which it leaves alone, moves here.
            const here = (await usable()).find(candidate => sameModel(candidate, resolved))
            if (here?.images === false) cause = { code: 'UNSUPPORTED_CONTENT', message: `${here.label} takes no pictures` }
          }
          if (cause !== undefined) {
            const start: RoutedTurn = { turn, use: resolved, resolved, fellBack: false }
            routedTurns.set(agent, start)
            if (await stepIn(agent, start, cause)) {
              pending.delete(agent)
              return on((routedTurns.get(agent) ?? start).use)
            }
            routedTurns.delete(agent)
          }
        }
        const asked = pending.get(agent)
        pending.delete(agent)
        if (asked === undefined || asked.turn !== turn || !routable(agent)) {
          // A turn the router does not decide (no person's message opened it, the chat is locked, routing is off)
          // keeps the chat where an earlier switch put it. Locking holds the current model; only a reset hands it back.
          const held = routed !== undefined && sameModel(resolved, routed.from) ? routed.to : resolved
          routedTurns.set(agent, { turn, use: held, resolved, fellBack: false })
          return on(held)
        }
        const settings = current()
        const record = foldBrainRecord(agent.session.events)
        const jev = settings.useJev === false ? undefined : await jevTarget(settings.jevUrl)
        const result = await routeTurn({
          resolved, routed, lastSwitchAt,
          message: asked.message, hasImages: asked.hasImages,
          brain: record === undefined ? undefined : { id: record.brain, instructions: record.instructions },
          contextTokens: contextTokensOf(agent.session.events),
          candidates: await usable(),
          ...criteria(record?.brain),
          preferFree: settings.preferFree ?? true,
          table: await scoreTable(home),
          ratings: await currentRatings(),
          now: new Date(),
        }, {
          askJev: settings.useJev === false
            ? undefined
            : (message, brain) => askJev(
              requestFor(message, brain === undefined ? undefined : { name: brain.id, instructions: brain.instructions }),
              { key: jev?.key, url: jev?.url ?? jevAddress(settings.jevUrl), timeoutMs: settings.jevTimeoutMs ?? JEV_TIMEOUT_MS },
            ),
          contextWindow: async candidate =>
            (await routeCtx.llm.resolveModelInfo(candidate.provider, candidate.model)).context?.contextWindow,
        })
        if (result.jevFailure !== undefined) lastJevFailure = { failure: result.jevFailure, at: new Date().toISOString() }
        else if (result.jev?.reading !== undefined) lastJevFailure = undefined
        readings.set(String(agent.session.header.id), { turn, reading: result.reading })
        for (const event of result.events) {
          const { rationale: _why, ...bare } = event
          agent.session.append('idealize/router', settings.showRationale === false ? bare : event, { ignorable: true })
        }
        routedTurns.set(agent, { turn, use: result.use, resolved, fellBack: false })
        void appendLog(home, entryFor(String(agent.session.header.id), result.decision, result.reading, {
          brain: record?.brain, jevFailure: result.jevFailure, jevMs: result.jev?.ms, jevCost: result.jev?.cost, from: result.from,
        }))
        return on(result.use)
      } catch (error) {
        // The router never fails a turn: whatever went wrong, the chat runs on the model it had.
        routeCtx.logger.warn(`idealize-router: routing failed, the chat keeps its model: ${String(error)}`)
        routedTurns.set(agent, { turn, use: resolved, resolved, fellBack: false })
        return resolved
      }
    }, { prepend: true })

    // The fallback: a model the router chose that cannot answer hands the turn back to the chat's own model, once.
    // Prepended, so it answers before the host's retry policy: a routed model that is busy or broken is not
    // retried on the person's time (each retry showed as a "Retry delay" notice); the chat's own model takes the turn at once.
    routeCtx.on('agent/request-error', async ({ agent, turn, failure, signal }, next) => {
      const routed = routedTurns.get(agent)
      if (signal.aborted || routed === undefined || routed.turn !== turn) return next()
      if (!routed.fellBack && !sameModel(routed.use, routed.resolved)) {
        const label = (model: { provider: string; model: string }) => ({ ...model, label: model.model })
        agent.session.append('idealize/router', {
          outcome: 'reset', at: new Date().toISOString(), from: label(routed.use), to: label(routed.resolved),
        }, { ignorable: true })
        routedTurns.set(agent, { ...routed, use: routed.resolved, fellBack: true, tried: [...routed.tried ?? [], routed.use] })
        refusals ??= await readRefusals(home)
        const cause = refusalCause(failure.code)
        await noteRefusal(home, refusals, routed.use, cause)
        routeCtx.logger.warn(`idealize-router: ${routeKey(routed.use)} failed (${failure.code}: ${failure.message}); the turn returns to ${routeKey(routed.resolved)} and ${REFUSAL_SPAN[cause]}`)
        return { kind: 'retry' }
      }
      // The chat's own model failed, or a stand-in did. The retry policy and compaction answer first, so the router
      // steps in only when the turn would otherwise end on the failure.
      const action = await next()
      // A stand-in is the router's own choice, so any failure of one moves on to the next (a provider can refuse a
      // history another model wrote); the chat's own model gets a stand-in only for a failure another model could cure.
      const onStandIn = (routed.standIns ?? 0) > 0
      // The person can stop the turn during `await next()`, which the compiler cannot see.
      if (action?.kind === 'retry' || signal.aborted || !(onStandIn || canStepIn(failure.code)) || !rescuable(agent)) return action
      try {
        return await stepIn(agent, routed, failure) ? { kind: 'retry' } : action
      } catch (error) {
        routeCtx.logger.warn(`idealize-router: stepping in failed, the turn ends on its failure: ${String(error)}`)
        return action
      }
    }, { prepend: true })

    /** The text of a message's content, pictures and tool calls left out. */
    const textOf = (content: ReadonlyArray<{ type: string; text?: string }>): string =>
      content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('\n').trim()

    /**
     * Read a finished turn, and offer another model when the chat's model said the work was beyond it. Runs after the
     * turn has ended and never holds it up; an offer arrives only while the person has not written again.
     */
    const checkReplyOf = async (agent: Agent, turn: number): Promise<void> => {
      const settings = current()
      const routed = routedTurns.get(agent)
      if (settings.useJev === false || settings.replyCheck === false || !rescuable(agent)) return
      // A model on this computer keeps the chat on it; its reply does not leave it either.
      if (routed?.turn !== turn || localRoute(routed.use.provider)) return
      const events = agent.session.events
      const reply = events.findLast(event => event.type === 'assistant/message' && event.data.turn === turn)
      const asked = events.findLast(event => event.type === 'user/message'
        && (event.data.source.kind === 'user' || (event.data.source.kind as string) === 'chat-brief'))
      if (reply?.type !== 'assistant/message' || asked?.type !== 'user/message') return
      const replyText = textOf(reply.data.message.content)
      const brief = (asked.data.source as { brief?: unknown }).brief
      const askText = typeof brief === 'string' ? brief : textOf(asked.data.content)
      if (replyText === '' || askText === '') return
      const { key, url } = await jevTarget(settings.jevUrl)
      if (key === undefined) return
      const seen = events.length
      const check = await checkReply(askText, replyText, { key, url })
      if (!saidItCannot(check)) return
      // The person wrote again while Jev read, so the offer would answer a turn that has moved on.
      if (agent.session.events.slice(seen).some(event => event.type === 'user/message')) return
      const session = String(agent.session.header.id)
      const record = foldBrainRecord(events)
      const read = readings.get(session)
      const reading = read?.turn === turn ? read.reading : readLocally(askText, record?.brain)
      const file = await currentRatings()
      const failed = routed.use
      const choice = await chooseStandIn({
        failed,
        code: 'SAID_CANNOT',
        tried: [],
        candidates: await usable(),
        reading,
        weights: criteria(record?.brain).weights,
        preferFree: settings.preferFree ?? true,
        contextTokens: contextTokensOf(events),
        hasImages: events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image')),
        offerOnly: true,
        table: await scoreTable(home),
        standingOf: candidate => standing(file, { kind: 'chat', model: candidate.model }, TASK_TAG[reading.task]),
      }, async candidate => (await routeCtx.llm.resolveModelInfo(candidate.provider, candidate.model)).context?.contextWindow)
      if (choice.kind === 'none') return
      const at = new Date().toISOString()
      const fromLabel = await labelOf(failed)
      const to = { provider: choice.to.provider, model: choice.to.model, label: choice.to.label }
      const rationale = `${fromLabel} said it couldn't do this.`
      agent.session.append('idealize/router', {
        outcome: 'offer', at, from: { ...failed, label: fromLabel }, to, task: reading.task, reason: 'said-cannot',
        ...settings.showRationale === false ? {} : { rationale },
      }, { ignorable: true })
      void appendLog(home, {
        at, session, brain: record?.brain, reading, from: routeKey(failed), to: routeKey(failed), switched: false,
        check: 'said-cannot', recommended: routeKey(choice.to), improvement: 0,
        switchConfidence: Number((check.confidence ?? 0).toFixed(3)), rationale,
        ...check.cost === undefined ? {} : { jevCost: check.cost }, jevMs: check.ms,
      })
    }

    // A turn that ended normally is read once it has ended, so the person never waits on the check.
    routeCtx.on('agent/turn-stopping', ({ agent, turn }) => {
      void checkReplyOf(agent, turn).catch((error: unknown) => {
        routeCtx.logger.warn(`idealize-router: the reply check failed, the chat carries on: ${String(error)}`)
      })
    })

    // The generating spaces: a generation moves to the model the person rated highest for the work its prompt asks
    // for, or stays on the stored choice. With no stars for the kind, nothing is read and nothing moves (JJ, 28 Oct 2026).
    routeCtx.on('generation/choose-model', async (choice, next) => {
      const stored = await next()
      try {
        const kind = PRESET_KIND[choice.presetId]
        const settings = current()
        const events = choice.session.events
        if (kind === undefined || settings.enabled === false || foldLocked(events)) return stored
        const record = foldBrainRecord(events)
        if (record !== undefined && (settings.offBrains ?? []).includes(record.brain)) return stored
        const named = (entry: GenCatalogEntry): RoutedModel =>
          ({ provider: entry.backend, model: entry.model.id, label: entry.model.name || entry.model.id })
        const kept = foldMediaKept(events, choice.presetId)
        const held = kept === undefined
          ? undefined
          : choice.candidates.find(entry => entry.backend === kept.to.provider && entry.model.id === kept.to.model)
        if (held !== undefined) return held
        const file = await currentRatings()
        if (!hasStarsFor(file, kind) || settings.useJev === false) return stored
        const tags = readableTags(kind, choice.hasReference)
        const read = await readPrompt(choice.prompt, kind, tags, {
          ...await jevTarget(settings.jevUrl), timeoutMs: settings.jevTimeoutMs ?? JEV_TIMEOUT_MS,
        })
        if (read.failure !== undefined) lastJevFailure = { failure: read.failure, at: new Date().toISOString() }
        if (read.reading === undefined || read.reading.confidence < MEDIA_CONFIDENCE) return stored
        const sessionId = String(choice.session.header.id)
        const byPreset = mediaReadings.get(sessionId) ?? new Map<string, string>()
        byPreset.set(choice.presetId, read.reading.tag)
        mediaReadings.set(sessionId, byPreset)
        const decision = decideMedia({
          kind, stored, candidates: runnable(routeCtx.get('generation'), choice.candidates), tag: read.reading.tag, ratings: file,
          aggressiveness: criteria(record?.brain).aggressiveness,
        })
        if (!decision.switched) return stored
        choice.session.append('idealize/router-media', {
          outcome: 'switched', at: new Date().toISOString(), presetId: choice.presetId,
          from: named(stored), to: named(decision.use), tag: read.reading.tag, rationale: decision.rationale,
        }, { ignorable: true })
        return decision.use
      } catch (error) {
        // The router never fails a generation: whatever went wrong, the stored choice runs.
        routeCtx.logger.warn(`idealize-router: choosing a media model failed, the stored choice runs: ${String(error)}`)
        return stored
      }
    })

    // A generation that cannot run on its model moves on, except where the person told the router to leave the chat alone.
    routeCtx.on('generation/replace-model', async (replacement, next) => {
      const settings = current()
      const record = foldBrainRecord(replacement.session.events)
      if (settings.enabled === false || foldLocked(replacement.session.events)) return undefined
      if (record !== undefined && (settings.offBrains ?? []).includes(record.brain)) return undefined
      return await next()
    })

    // The free-token engine picks its provider on the brain's priorities: every request of a chat carries them.
    routeCtx.inject(['idealizeAttribution', 'sessions'], (engineCtx) => {
      const attribution = engineCtx.get('idealizeAttribution') as {
        contribute?: (contributor: (sessionId: string) => Record<string, string> | undefined) => () => void
      } | undefined
      if (attribution?.contribute === undefined) return
      engineCtx.effect(() => attribution.contribute?.((sessionId) => {
        const session = engineCtx.sessions.get(SessionId(sessionId))
        if (session === undefined) return undefined
        const brain = foldBrainRecord(session.events)?.brain
        return { [ROUTING_HEADER]: routingHeaderValue(engineWeights(criteria(brain).weights)) }
      }) ?? (() => {}), 'idealize-router: engine routing header')
    })

    routeCtx.inject(['webServer', 'sessions'], (webCtx) => {
      type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
      const register = (path: string, mutating: boolean, handler: RouteHandler): void => {
        webCtx.effect(
          () => webCtx.webServer.register({
            kind: 'exact',
            path,
            handler: async (req, res) => {
              if (refuse(req, res, mutating)) return
              try {
                await handler(req, res)
              } catch (error) {
                sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
              }
            },
          }),
          `idealize-router: ${path}`,
        )
      }

      register('/idealize/router/state', false, async (_req, res) => {
        const settings = current()
        let scoresUnreadable = false
        const table = await scoreTable(home, () => { scoresUnreadable = true })
        sendJson(res, 200, {
          scoresUnreadable,
          settings: {
            enabled: settings.enabled ?? true,
            aggressiveness: settings.aggressiveness ?? 'balanced',
            preferFree: settings.preferFree ?? true,
            showRationale: settings.showRationale ?? true,
            useJev: settings.useJev ?? true,
            offBrains: settings.offBrains ?? [],
          },
          weights: weights(),
          brains: settings.brains ?? {},
          shippedBrains: SHIPPED_CRITERIA,
          jev: { keyed: (await jevTarget(undefined)).key !== undefined, lastFailure: lastJevFailure },
          families: table.map(row => ({ family: row.family, speed: row.speed, scores: row.scores, yours: !SHIPPED_SCORES.includes(row) })),
          candidates: (await usable()).length,
          refused: Object.entries(refusals ?? {}).filter(entry => entry[1] > Date.now()).map(entry => entry[0]),
        })
      })

      register('/idealize/router/settings', true, async (req, res) => {
        const body = await readBody(req)
        const next: RouterConfig = {}
        for (const flag of ['enabled', 'preferFree', 'showRationale', 'useJev'] as const) {
          if (typeof body[flag] === 'boolean') next[flag] = body[flag]
        }
        if (body.aggressiveness === 'conservative' || body.aggressiveness === 'balanced' || body.aggressiveness === 'aggressive') {
          next.aggressiveness = body.aggressiveness
        }
        if (Array.isArray(body.offBrains) && body.offBrains.every(item => typeof item === 'string')) next.offBrains = body.offBrains
        if (Object.keys(next).length === 0) {
          sendJson(res, 400, { error: 'nothing to change: send enabled, aggressiveness, preferFree, showRationale, useJev or offBrains' })
          return
        }
        await webCtx.settings.update(NS, next)
        sendJson(res, 200, { ok: true })
      })

      register('/idealize/router/brain', true, async (req, res) => {
        const body = await readBody(req)
        if (typeof body.brain !== 'string' || body.brain === '') {
          sendJson(res, 400, { error: 'brain must name a brain' })
          return
        }
        const entry: BrainCriteria = {}
        if (body.aggressiveness === 'conservative' || body.aggressiveness === 'balanced' || body.aggressiveness === 'aggressive') {
          entry.aggressiveness = body.aggressiveness
        }
        for (const axis of ['cost', 'speed', 'intelligence'] as const) {
          const value = body[axis]
          if (typeof value === 'number' && Number.isFinite(value) && value >= 0) entry[axis] = value
        }
        if (Object.keys(entry).length === 0) {
          sendJson(res, 400, { error: 'nothing to change: send aggressiveness, cost, speed or intelligence' })
          return
        }
        const brains = current().brains ?? {}
        await webCtx.settings.update(NS, { brains: { ...brains, [body.brain]: { ...brains[body.brain], ...entry } } })
        sendJson(res, 200, { ok: true })
      })

      const sessionOf = (body: Record<string, unknown>, res: ServerResponse) => {
        const session = typeof body.sessionId === 'string' ? webCtx.sessions.get(SessionId(body.sessionId)) : undefined
        if (session === undefined) sendJson(res, 404, { error: 'no live session with that sessionId' })
        return session
      }

      register('/idealize/router/lock', true, async (req, res) => {
        const body = await readBody(req)
        if (typeof body.locked !== 'boolean') {
          sendJson(res, 400, { error: 'locked must be true or false' })
          return
        }
        const session = sessionOf(body, res)
        if (session === undefined) return
        if (foldLocked(session.events) !== body.locked) session.append('idealize/router-lock', { locked: body.locked }, { ignorable: true })
        sendJson(res, 200, { ok: true, locked: body.locked })
      })

      register('/idealize/router/reset', true, async (req, res) => {
        const session = sessionOf(await readBody(req), res)
        if (session === undefined) return
        // Whatever the chat last showed, a switch or an offer, is answered: the badge clears and the throttle counts from now.
        // A taken offer is recorded as a switch, because a chat another chat started keeps its own model and only the router moves it.
        const last = session.events.findLast(event => event.type === 'idealize/router')
        const open = last?.type === 'idealize/router' && last.data.outcome !== 'reset' ? last.data : undefined
        if (open !== undefined) {
          const at = new Date().toISOString()
          session.append('idealize/router', open.outcome === 'offer'
            ? { outcome: 'switched', at, from: open.from, to: open.to, via: 'offer' }
            : { outcome: 'reset', at, from: open.to, to: open.from }, { ignorable: true })
        }
        sendJson(res, 200, { ok: true, reset: open !== undefined })
      })

      register('/idealize/router/ratings', false, async (req, res) => {
        if (req.method === 'POST') {
          if (req.headers['x-idealize-auth'] !== '1') {
            res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
            return
          }
          const body = await readBody(req)
          const { kind, provider, model, tag, stars } = body
          if (!isRatingKind(kind) || typeof provider !== 'string' || typeof model !== 'string' || model === '') {
            sendJson(res, 400, { error: 'send kind (chat, image, video or audio), provider and model' })
            return
          }
          if (!isTag(kind, tag)) {
            sendJson(res, 400, { error: `tag must be one of ${RATING_TAGS[kind].join(', ')}` })
            return
          }
          if (stars !== null && !isStars(stars)) {
            sendJson(res, 400, { error: 'stars must be 1 to 5, or null to clear' })
            return
          }
          const label = typeof body.label === 'string' ? body.label : undefined
          const file = await rate((next) => {
            setStars(next, { kind, provider, model }, tag, stars ?? undefined, new Date().toISOString(), label)
          })
          sendJson(res, 200, { ok: true, models: file.models })
          return
        }
        sendJson(res, 200, { tags: RATING_TAGS, models: (await currentRatings()).models })
      })

      const sessionParam = (req: IncomingMessage, res: ServerResponse) => {
        const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId') ?? undefined
        return sessionOf({ sessionId: id }, res)
      }
      const generation = (): GenerationFace | undefined => routeCtx.get('generation')
      const presetOf = (kind: Exclude<RatingKind, 'chat'>) => MEDIA_PRESETS.find(preset => preset.id === KIND_PRESET[kind])
      const starsOf = (file: RatingsFile, kind: RatingKind, model: string): Record<string, number> =>
        Object.fromEntries(Object.entries(ratingsOf(file, { kind, model }))
          .flatMap(([tag, rating]) => rating.stars === undefined ? [] : [[tag, rating.stars]]))

      /** The kind of work a chat's reply answered: the router's reading for that turn, else the keyword rules on the ask. */
      const chatReading = (session: Session, reply: { seq: number; turn: number }): TaskReading => {
        const held = readings.get(String(session.header.id))
        if (held !== undefined && held.turn === reply.turn) return held.reading
        return readLocally(askBefore(session, reply.seq)?.ask ?? '', foldBrainRecord(session.events)?.brain)
      }

      /** What the heart's line and a dislike are about in this chat. */
      const subjectOf = async (session: Session) => {
        const kind = SPACE_KIND[resolveSessionSpace(session)]
        const file = await currentRatings()
        if (kind === 'chat') {
          const reply = lastReply(session.events)
          if (reply === undefined) return undefined
          const reading = chatReading(session, reply)
          const model = { provider: reply.provider, model: reply.model, label: await labelOf(reply) }
          return { kind, model, tag: TASK_TAG[reading.task], reading, reply, file }
        }
        if (kind === undefined) return undefined
        const record = lastArtefact(session.events)
        const recordKind = record === undefined ? undefined : kindOfMedia(record.mediaType)
        if (record === undefined || recordKind === undefined) return undefined
        const preset = presetOf(recordKind)
        const entry = preset === undefined
          ? undefined
          : generation()?.compatible(preset.requiredCapabilities)
            .find(one => one.backend === record.provenance.provider && one.model.id === record.provenance.model)
        const model = {
          provider: record.provenance.provider, model: record.provenance.model, label: entry?.model.name || record.provenance.model,
        }
        const tag = mediaReadings.get(String(session.header.id))?.get(KIND_PRESET[recordKind]) ?? mediaTagFor(recordKind, model.model, file)
        return { kind: recordKind, model, tag, record, file }
      }

      register('/idealize/router/rate-target', false, async (req, res) => {
        const session = sessionParam(req, res)
        if (session === undefined) return
        const subject = await subjectOf(session)
        if (subject === undefined) {
          sendJson(res, 409, { error: 'this chat has no answer to rate yet' })
          return
        }
        sendJson(res, 200, {
          kind: subject.kind, ...subject.model, tag: subject.tag, tags: RATING_TAGS[subject.kind],
          stars: starsOf(subject.file, subject.kind, subject.model.model),
        })
      })

      /** The two models a dislike offers, and what both runs should cost. */
      const offerFor = async (session: Session) => {
        const subject = await subjectOf(session)
        if (subject === undefined) return { error: 'this chat has no answer to compare yet' }
        const { kind, tag, file } = subject
        if (subject.kind === 'chat') {
          const record = foldBrainRecord(session.events)
          const hasImages = session.events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'image'))
          const picked = alternativesFor({
            current: subject.model, candidates: await usable(), reading: subject.reading, weights: criteria(record?.brain).weights,
            hasImages, table: await scoreTable(home),
            standingOf: candidate => standing(file, { kind: 'chat', model: candidate.model }, tag),
          })
          return {
            kind, tag, first: subject.model,
            alternatives: picked.map(one => ({ provider: one.provider, model: one.model, label: one.label })),
            price: compareCost(picked.map(one => one.price), subject.reply.usage),
          }
        }
        const settings = subject.record.settings as Record<string, unknown>
        if (typeof settings.reference_image === 'string' && settings.reference_image !== '') {
          return { error: 'this one started from a picture; other models can only be tried on a prompt for now' }
        }
        const preset = presetOf(subject.kind)
        const all = preset === undefined ? [] : runnable(generation(), generation()?.compatible(preset.requiredCapabilities) ?? [])
        const picked = mediaAlternativesFor({
          kind: subject.kind, current: { backend: subject.model.provider, model: subject.model.model }, candidates: all, tag, ratings: file,
        })
        const count = typeof settings.count === 'number' && settings.count > 0 ? settings.count : 1
        return {
          kind, tag, first: subject.model,
          alternatives: picked.map(one => ({ provider: one.backend, model: one.model.id, label: one.model.name || one.model.id })),
          price: mediaCost(picked, count),
        }
      }

      register('/idealize/router/offer', false, async (req, res) => {
        const session = sessionParam(req, res)
        if (session === undefined) return
        const offer = await offerFor(session)
        if ('error' in offer) {
          sendJson(res, 409, offer)
          return
        }
        if (offer.alternatives.length === 0) {
          sendJson(res, 409, { error: 'no other connected model can take this ask' })
          return
        }
        sendJson(res, 200, offer)
      })

      const appendStep = (session: Session, step: RouterCompareEventData): void => {
        try {
          session.append('idealize/router-compare', step, { ignorable: true })
        } catch (error) {
          // A chat closed mid-run has nowhere to put the answer; it is dropped.
          routeCtx.logger.warn(`idealize-router: a comparison step could not be recorded: ${String(error)}`)
        }
      }

      /** One chat alternative: the same history, one answer, no tools run. */
      const answerOn = async (session: Session, messages: Message[], model: RoutedModel): Promise<Pick<RouterCompareEventData, 'text' | 'failed'>> => {
        const header = session.requestHeader()
        const options: GenerateOptions = {
          provider: model.provider,
          model: model.model,
          messages,
          system: [header?.system, ANSWER_IN_TEXT].filter(part => part !== undefined && part !== '').join('\n\n'),
          // Earlier turns may hold tool calls, and some providers refuse those without the tools declared.
          ...header?.tools === undefined || header.tools.length === 0 ? {} : { tools: [...header.tools] },
          signal: AbortSignal.timeout(COMPARE_CHAT_MS),
        }
        try {
          const assembler = new BlockAssembler()
          for await (const chunk of routeCtx.llm.stream(options)) assembler.push(chunk)
          const finish = assembler.finish
          if (finish.kind === 'error' || finish.kind === 'aborted') return { failed: finish.failure.message }
          const blocks = assembler.blocks()
          const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
          if (text !== '') return { text }
          const tool = blocks.find(block => block.type === 'tool-call')
          return { failed: tool?.type === 'tool-call' ? `It tried to run ${tool.name} instead of answering.` : 'It gave no answer.' }
        } catch (error) {
          return { failed: error instanceof Error ? error.message : String(error) }
        }
      }

      /** One media alternative: the same prompt and settings on another model, kept as the chat's artefacts. */
      const makeOn = async (session: Session, record: ArtefactRecord, kind: Exclude<RatingKind, 'chat'>, model: RoutedModel, callId: string): Promise<Pick<RouterCompareEventData, 'artefacts' | 'failed'>> => {
        const service = generation()
        const artefacts = routeCtx.get('artefacts') as ArtefactsFace | undefined
        const preset = presetOf(kind)
        if (service === undefined || artefacts === undefined || preset === undefined) return { failed: 'Generation is not available in this app.' }
        const settings = record.settings as Record<string, unknown>
        const workspaces = routeCtx.get('workspaceRegistry') as { resolveByPath?(path: string): Promise<{ path: string } | undefined> } | undefined
        const cwd = session.header.cwd ?? ''
        const projectPath = (await workspaces?.resolveByPath?.(cwd).catch(() => undefined))?.path ?? cwd
        try {
          const result = await service.generate({
            schemaVersion: GENERATION_SCHEMA_VERSION,
            taskIntent: preset.taskIntent,
            requiredCapabilities: preset.requiredCapabilities,
            model: { backend: model.provider, model: model.model },
            prompt: typeof settings.prompt === 'string' ? settings.prompt : '',
            settings,
            projectPath,
          }, undefined, AbortSignal.timeout(COMPARE_MEDIA_MS))
          const made: ArtefactRecord[] = []
          for (const output of result.outputs) {
            made.push(await artefacts.create({
              session,
              mediaType: output.mediaType,
              bytes: Buffer.from(output.data, 'base64'),
              settings: record.settings,
              sourceTask: { turnSeq: record.sourceTask.turnSeq, callId: callId as CallId, toolName: record.sourceTask.toolName },
              provenance: { ...record.provenance, provider: result.backend, model: result.model },
            }))
          }
          return made.length === 0 ? { failed: 'It made nothing.' } : { artefacts: made.map(one => ({ id: String(one.id), mediaType: one.mediaType })) }
        } catch (error) {
          return { failed: error instanceof Error ? error.message : String(error) }
        }
      }

      register('/idealize/router/compare', true, async (req, res) => {
        const body = await readBody(req)
        const session = sessionOf(body, res)
        if (session === undefined) return
        const sessionId = String(session.header.id)
        if (comparing.has(sessionId)) {
          sendJson(res, 409, { error: 'a comparison is already running in this chat' })
          return
        }
        const offer = await offerFor(session)
        if ('error' in offer) {
          sendJson(res, 409, offer)
          return
        }
        // The models the person was shown, where they are still on offer; otherwise the offer as it stands now.
        const asked = Array.isArray(body.alternatives)
          ? offer.alternatives.filter(one => (body.alternatives as unknown[]).some(item =>
            typeof item === 'object' && item !== null && sameModel(item as RoutedModel, one)))
          : []
        const alternatives = asked.length > 0 ? asked : offer.alternatives
        if (alternatives.length === 0) {
          sendJson(res, 409, { error: 'no other connected model can take this ask' })
          return
        }
        const id = randomUUID()
        const subject = await subjectOf(session)
        const replySeq = subject?.kind === 'chat' ? subject.reply.seq : undefined
        const ask = replySeq === undefined ? undefined : askBefore(session, replySeq)
        if (offer.kind === 'chat' && ask === undefined) {
          sendJson(res, 409, { error: 'the message that reply answered is no longer in the chat' })
          return
        }
        appendStep(session, {
          id, phase: 'started', at: new Date().toISOString(), kind: offer.kind, tag: offer.tag,
          first: offer.first, alternatives, ...replySeq === undefined ? {} : { replySeq },
        })
        comparing.add(sessionId)
        sendJson(res, 200, { ok: true, id })
        const record = subject !== undefined && subject.kind !== 'chat' ? subject.record : undefined
        void Promise.all(alternatives.map(async (model, index) => {
          const outcome = ask !== undefined
            ? await answerOn(session, ask.messages, model)
            : record !== undefined && offer.kind !== 'chat'
              ? await makeOn(session, record, offer.kind, model, `compare-${id}-${String(index)}`)
              : { failed: 'There was nothing to try it on.' }
          appendStep(session, { id, phase: 'answer', at: new Date().toISOString(), index, ...outcome })
        })).finally(() => { comparing.delete(sessionId) })
      })

      register('/idealize/router/pick', true, async (req, res) => {
        const body = await readBody(req)
        const session = sessionOf(body, res)
        if (session === undefined) return
        const state = typeof body.id === 'string' ? foldCompare(session.events, body.id) : undefined
        const index = body.index
        if (state === undefined || typeof index !== 'number' || !Number.isInteger(index)) {
          sendJson(res, 400, { error: 'send the comparison id and the index kept (-1 for the first answer)' })
          return
        }
        if (state.picked !== undefined) {
          sendJson(res, 409, { error: 'this comparison has already been decided' })
          return
        }
        const { id, kind, tag, first } = state.started
        const at = new Date().toISOString()
        if (index === -1) {
          appendStep(session, { id, phase: 'picked', at, index: -1 })
          sendJson(res, 200, { ok: true })
          return
        }
        const kept = state.started.alternatives?.[index]
        const answer = state.answers[index]
        const made = answer?.text !== undefined || (answer?.artefacts?.length ?? 0) > 0
        if (kept === undefined || first === undefined || kind === undefined || tag === undefined || !made) {
          sendJson(res, 409, { error: 'that alternative has no answer to keep' })
          return
        }
        // Quiet marks: a small step up for the answer kept, a small step down for the one passed over.
        await rate((file) => {
          addMark(file, { kind, ...kept }, tag, 1, at, kept.label)
          addMark(file, { kind, ...first }, tag, -1, at, first.label)
        })
        let replaced = false
        if (kind === 'chat') {
          const replySeq = state.started.replySeq
          // The kept answer takes the first reply's place in what the model reads, while the chat is idle on that reply.
          if (replySeq !== undefined && answer?.text !== undefined && lastReply(session.events)?.seq === replySeq
            && session.surface.nodes.includes(replySeq)) {
            session.append('user/message', createUserMessage({
              content: [{ type: 'text', text: keptNote(kept.label, answer.text) }],
              source: { kind: 'plugin', plugin: name },
            }), { surfaceOp: { op: 'replace', start: replySeq, end: replySeq }, sourceEventSeqs: [replySeq] })
            replaced = true
          }
          // The chat moves onto the kept model the way a router switch does, so the composer's chip can take it back.
          const { routed } = foldRouted(session.events)
          const own = routed !== undefined && sameModel(routed.to, first) ? routed.from : first
          session.append('idealize/router', sameModel(own, kept)
            ? { outcome: 'reset', at, from: first, to: kept, via: 'dislike' }
            : { outcome: 'switched', at, from: own, to: kept, via: 'dislike', rationale: `You kept ${kept.label}'s answer.` },
          { ignorable: true })
        } else {
          session.append('idealize/router-media', { outcome: 'kept', at, presetId: KIND_PRESET[kind], from: first, to: kept, tag }, { ignorable: true })
        }
        appendStep(session, { id, phase: 'picked', at, index })
        sendJson(res, 200, { ok: true, replaced })
      })

      register('/idealize/router/log', false, async (req, res) => {
        const limit = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('limit') ?? '50')
        sendJson(res, 200, { entries: await readLog(home, Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50) })
      })
    })
  })
}
