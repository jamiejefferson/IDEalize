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
 * HTTP surface (loopback-fenced; mutations demand the header):
 * - GET  /idealize/router/state — settings, the weights it reads, whether Jev is reachable, the last Jev failure, and the capability table.
 * - POST /idealize/router/settings — any of {enabled, aggressiveness, preferFree, showRationale, useJev, offBrains}.
 * - POST /idealize/router/brain — {brain, aggressiveness?, cost?, speed?, intelligence?}: one brain's own criteria.
 * - POST /idealize/router/lock — {sessionId, locked}.
 * - POST /idealize/router/reset — {sessionId}: the user took the model back; the earlier switch no longer holds.
 * - GET  /idealize/router/log?limit=n — the newest decisions, newest first.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { effectivePrices, readOpenRouterPriceCache } from '@idealize/models'
import type { TokenPriceTable } from '@idealize/models'
import { shippedTokenPrices } from '@idealize/services'
import { foldBrainRecord, resolveSessionSpace } from '@idealize/spaces'

import { candidatesFrom, FREE_PROVIDER } from './candidates.ts'
import { criteriaFor, engineWeights, ROUTING_HEADER, routingHeaderValue, SHIPPED_CRITERIA } from './criteria.ts'
import type { BrainCriteria, Criteria } from './criteria.ts'
import type { ConnectedRoute, RouteAuth } from './candidates.ts'
import type { Aggressiveness, Candidate, Weights } from './decide.ts'
import { askJev, JEV_TIMEOUT_MS, JEV_URL, requestFor } from './jev.ts'
import type { JevFailure } from './jev.ts'
import { appendLog, entryFor, readLog } from './log.ts'
import { foldLocked, foldRouted, routerProjectionDefinition } from './projection.ts'
import { noteRefusal, readRefusals, routeKey } from './refused.ts'
import type { Refusals } from './refused.ts'
import { routeTurn } from './route.ts'
import { SHIPPED_SCORES } from './score-table.ts'
import type { ScoreRow } from './score-table.ts'

export { candidatesFrom } from './candidates.ts'
export { criteriaFor, engineWeights, ROUTING_HEADER, routingHeaderValue, SHIPPED_CRITERIA } from './criteria.ts'
export type { BrainCriteria, Criteria, EngineWeights } from './criteria.ts'
export { decide, PRESETS, rationaleFor, score } from './decide.ts'
export type { Aggressiveness, Candidate, Decision, Scored, StayReason, Weights } from './decide.ts'
export { askJev, requestFor } from './jev.ts'
export { currentModel, foldLocked, foldRouted, routerProjectionDefinition } from './projection.ts'
export type { RoutedModel, RouterEventData, RouterLockEventData, RouterProjection } from './projection-types.ts'
export { routeTurn } from './route.ts'
export { SHIPPED_SCORES } from './score-table.ts'
export type { ScoreRow } from './score-table.ts'
export { readLocally, TASKS } from './tasks.ts'
export type { TaskReading, TaskType } from './tasks.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'idealize-router'

const NS = settingsNamespace('idealize-router')
const MODELS_NS = settingsNamespace('idealize-models')
const LLM_NS = settingsNamespace('llm-pi-ai')
const OPENROUTER_KEY_ENV = 'OPENROUTER_API_KEY'
/** The user's own capability rows, read over the shipped table. */
const USER_SCORES_FILE = 'router-scores.json'
/** Routes and their model lists change rarely; a turn does not wait on them twice a minute. */
const CANDIDATES_FRESH_MS = 60_000

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
  /** OpenRouter marks the Decisions endpoint alpha, so its address is config. */
  jevUrl?: string
  /** The longest a turn waits on Jev, in milliseconds. */
  jevTimeoutMs?: number
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
    let refusals: Refusals | undefined

    /** A stored key first; a person who signed in to OpenRouter holds a key in the sign-in store, under `access`. */
    const openRouterKey = async (): Promise<string | undefined> => {
      const stored = (await routeCtx.credentials.resolve(credentialRef(OPENROUTER_KEY_ENV)).catch(() => undefined))?.value
      if (stored !== undefined && stored !== '') return stored
      const signedIn = await (routeCtx.get('idealizeOAuth') as OAuthFace | undefined)?.store?.read('openrouter').catch(() => undefined)
      return typeof signedIn?.access === 'string' && signedIn.access !== '' ? signedIn.access : undefined
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
      const llm = routeCtx.settings.get(LLM_NS) as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined
      const profiles = llm?.providers ?? {}
      const oauth = routeCtx.get('idealizeOAuth') as OAuthFace | undefined
      const subs = oauth?.status === undefined ? [] : await oauth.status().catch(() => [])
      const routes = await Promise.all(routeCtx.llm.listConfigurableProviders().map(async (entry): Promise<ConnectedRoute | undefined> => {
        const apiKeyEnv = profiles[entry.provider]?.apiKeyEnv
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
      return routes.filter((route): route is ConnectedRoute => route !== undefined && route.models.length > 0)
    }

    const candidates = async (): Promise<Candidate[]> => {
      if (cached !== undefined && Date.now() - cached.at < CANDIDATES_FRESH_MS) return cached.candidates
      const routes = await connectedRoutes()
      const user = (routeCtx.settings.get(MODELS_NS) as { tokenPrices?: TokenPriceTable } | undefined)?.tokenPrices ?? {}
      const shipped: TokenPriceTable = {}
      for (const route of routes) {
        const prices = shippedTokenPrices(route.provider)
        if (prices !== undefined) shipped[route.provider] = prices
      }
      const prices = effectivePrices(user, readOpenRouterPriceCache(home)?.prices, shipped)
      cached = { at: Date.now(), candidates: candidatesFrom(routes, prices) }
      return cached.candidates
    }

    /** The candidates, less the models that refused a routed turn lately. */
    const usable = async (): Promise<Candidate[]> => {
      refusals ??= await readRefusals(home)
      const live = refusals
      const now = Date.now()
      return (await candidates()).filter(candidate => (live[routeKey(candidate)] ?? 0) <= now)
    }

    /** Whether this chat is one the router routes this turn. */
    const routable = (agent: Agent): boolean => {
      const settings = current()
      if (settings.enabled === false) return false
      const events = agent.session.events
      if (resolveSessionSpace(agent.session) !== 'chat' || foldLocked(events)) return false
      const brain = foldBrainRecord(events)?.brain
      return brain === undefined || !(settings.offBrains ?? []).includes(brain)
    }

    routeCtx.on('agent/pre-step', async ({ agent, turn }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      const mine = decision.messages.filter(message => message.source.kind === 'user')
      const message = mine.flatMap(item => item.content).map(block => (block.type === 'text' ? block.text : '')).join('\n').trim()
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
        const { routed, lastSwitchAt } = foldRouted(agent.session.events)
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
        const key = settings.useJev === false ? undefined : await openRouterKey()
        const result = await routeTurn({
          resolved, routed, lastSwitchAt,
          message: asked.message, hasImages: asked.hasImages,
          brain: record === undefined ? undefined : { id: record.brain, instructions: record.instructions },
          contextTokens: contextTokensOf(agent.session.events),
          candidates: await usable(),
          ...criteria(record?.brain),
          preferFree: settings.preferFree ?? true,
          table: await scoreTable(home),
          now: new Date(),
        }, {
          askJev: settings.useJev === false
            ? undefined
            : (message, brain) => askJev(
              requestFor(message, brain === undefined ? undefined : { name: brain.id, instructions: brain.instructions }),
              { key, url: settings.jevUrl ?? JEV_URL, timeoutMs: settings.jevTimeoutMs ?? JEV_TIMEOUT_MS },
            ),
          contextWindow: async candidate =>
            (await routeCtx.llm.resolveModelInfo(candidate.provider, candidate.model)).context?.contextWindow,
        })
        if (result.jevFailure !== undefined) lastJevFailure = { failure: result.jevFailure, at: new Date().toISOString() }
        else if (result.jev?.reading !== undefined) lastJevFailure = undefined
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
        return resolved
      }
    }, { prepend: true })

    // The fallback: a model the router chose that cannot answer hands the turn back to the chat's own model, once.
    // Prepended, so it answers before the host's retry policy: a routed model that is busy or broken is not
    // retried on the person's time (each retry showed as a "Retry delay" notice); the chat's own model takes the turn at once.
    routeCtx.on('agent/request-error', async ({ agent, turn, failure, signal }, next) => {
      const routed = routedTurns.get(agent)
      const mine = routed !== undefined && routed.turn === turn && !routed.fellBack && !sameModel(routed.use, routed.resolved)
      if (signal.aborted || routed === undefined || !mine) return next()
      const label = (model: { provider: string; model: string }) => ({ ...model, label: model.model })
      agent.session.append('idealize/router', {
        outcome: 'reset', at: new Date().toISOString(), from: label(routed.use), to: label(routed.resolved),
      }, { ignorable: true })
      routedTurns.set(agent, { ...routed, use: routed.resolved, fellBack: true })
      refusals ??= await readRefusals(home)
      const cause = failure.code === 'RATE_LIMIT' ? 'rate-limited' : 'refused'
      await noteRefusal(home, refusals, routed.use, cause)
      routeCtx.logger.warn(`idealize-router: ${routeKey(routed.use)} failed (${failure.code}: ${failure.message}); the turn returns to ${routeKey(routed.resolved)} and the router leaves that model alone for ${cause === 'rate-limited' ? 'an hour' : 'a week'}`)
      return { kind: 'retry' }
    }, { prepend: true })

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
          jev: { keyed: (await openRouterKey()) !== undefined, lastFailure: lastJevFailure },
          families: table.map(row => ({ family: row.family, speed: row.speed, scores: row.scores, yours: !SHIPPED_SCORES.includes(row) })),
          candidates: (await usable()).length,
          refused: Object.keys(refusals ?? {}),
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
        const last = session.events.findLast(event => event.type === 'idealize/router')
        const open = last?.type === 'idealize/router' && last.data.outcome !== 'reset' ? last.data : undefined
        if (open !== undefined) {
          session.append('idealize/router', { outcome: 'reset', at: new Date().toISOString(), from: open.to, to: open.from }, { ignorable: true })
        }
        sendJson(res, 200, { ok: true, reset: open !== undefined })
      })

      register('/idealize/router/log', false, async (req, res) => {
        const limit = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('limit') ?? '50')
        sendJson(res, 200, { entries: await readLog(home, Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 50) })
      })
    })
  })
}
