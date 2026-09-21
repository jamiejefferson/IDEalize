/**
 * IDEalize model management: the host-served models panel. Reads the live
 * provider directory + model lists from the llm service, sets the default
 * model through the agent-default-model settings section, and stores the
 * auto-selection preference weights (cost / speed / intelligence). With mode
 * `auto` the policy (policy.ts) re-evaluates on a timer and keeps the default
 * pointed at the best usable route — free tokens first while the engine has
 * key headroom, the ChatGPT subscription otherwise. A chat pinned to a model
 * keeps it; the default only steers new chats and unpinned scheduled runs.
 * The in-app client-slot panel follows once JJ settles the design; this page
 * is the working draft of it.
 *
 * HTTP surface (loopback-fenced; mutations demand the header):
 * - GET  /idealize/models — the panel page.
 * - GET  /idealize/models/state — providers+models (display names resolved
 *   through `@idealize/services`' directory, each with where its catalogue
 *   comes from), default, mode, auto verdict, preferences, and `readAt`.
 * - POST /idealize/models/default — {provider, model} becomes the default (switches mode to manual).
 * - POST /idealize/models/mode — {mode: 'manual'|'auto'}; auto evaluates at once.
 * - POST /idealize/models/preferences — {cost, speed, intelligence} weights.
 * - GET  /idealize/models/usage?scope=<project path> — month-to-date and
 *   year-to-date tokens per billing category (usage.ts), the project list,
 *   the monthly budget, and the cost breakdown computed from the configured
 *   token prices and subscription plan costs (pricing.ts), plus one row per
 *   model with usage this month; no scope folds every session. Three sources
 *   price a token, the person's entry over OpenRouter's published directory
 *   over the catalogue the app ships (prices.ts). The same pass counts the
 *   media the app generated this month per endpoint, and reports what fal
 *   billed for it (generations.ts).
 * - POST /idealize/models/budget — {monthlyTokenBudget} (0 clears it).
 * - POST /idealize/models/prices — {provider, model, price} stores one
 *   model's token prices; `price: null` clears it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-agent-default-model'
import type { AgentDefaultModelSettings } from '@deepseek-ai/dsh-agent-default-model'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { serviceName, SHIPPED_PRICE_CURRENCY, shippedTokenPrices } from '@idealize/services'

import { createEngineKeyReader } from './engine-keys.ts'
import { emptyGenerationPeriods, FAL_PROVIDER, foldGenerations, generationRows, refreshFalUsage } from './generations.ts'
import type { FalUsageCache } from './generations.ts'
import { modelsPage } from './models-page.ts'
import { choose, freeUsable } from './policy.ts'
import type { FreetokensFacts, PolicyDecision } from './policy.ts'
import { effectivePrices, OPENROUTER_PROVIDER, parsePriceBody, refreshOpenRouterPrices } from './prices.ts'
import { costBreakdown, modelRows } from './pricing.ts'
import type { SubscriptionPlan, TokenPrice, TokenPriceTable } from './pricing.ts'
import { categoryOf, emptyUsagePeriods, foldUsage } from './usage.ts'

export { costBreakdown, meteredCost, modelRows, subscriptionCost } from './pricing.ts'
export type {
  CostBreakdown, CostTotals, ModelCostRow, SubscriptionPlan, SubscriptionPlanTable, TokenPrice, TokenPriceTable,
} from './pricing.ts'
export {
  effectivePrices, OPENROUTER_MODELS_URL, OPENROUTER_PROVIDER, openRouterPrices, parsePriceBody,
  readOpenRouterPriceCache, refreshOpenRouterPrices, writeOpenRouterPriceCache,
} from './prices.ts'
export type { OpenRouterPriceCache, PricedModel, PricedTable, PriceSource, PriceWrite } from './prices.ts'
export {
  emptyGenerationPeriods, FAL_PROVIDER, FAL_USAGE_URL, falUsageLines, foldGenerations, generationRows,
  readFalUsageCache, refreshFalUsage, writeFalUsageCache,
} from './generations.ts'
export type {
  BilledTotals, FalBilledLine, FalUsageCache, GenerationCount, GenerationPeriods, GenerationRow, PeriodGenerations,
} from './generations.ts'
export { categoryOf, emptyUsagePeriods, foldUsage, totalTokens, USAGE_CATEGORIES } from './usage.ts'
export type { CategoryFacts, ModelTokens, PeriodModels, UsageCategory, UsagePeriods, UsageTotals } from './usage.ts'

const NS = settingsNamespace('idealize-models')
const LLM_NS = settingsNamespace('llm-pi-ai')
/** Written by @idealize/freetokens when it provisions the embedded engine. */
const FREETOKENS_ADMIN_PASSWORD_ENV = 'FREETOKENS_ADMIN_PASSWORD'
const EVALUATE_EVERY_MS = 180_000
/** The free-tokens provider route id (written by @idealize/freetokens). */
const FREE_PROVIDER = 'freetokens'

/** Auto-selection preference weights (relative, not percentages), mode, and the monthly token budget. */
export interface ModelsConfig {
  /** Weight for the free-first axis; the heaviest of the three decides the auto choice, ties favouring cost. */
  cost?: number
  /** Weight for response speed; when it leads, a `-mini` subscription variant is preferred. */
  speed?: number
  /** Weight for model capability; when it leads, the subscription flagship is preferred over the free route. */
  intelligence?: number
  /** `auto` lets the policy re-evaluate the default model every three minutes; `manual` leaves the user's pick alone. */
  mode?: 'manual' | 'auto'
  /** Tokens per calendar month the Budget tab measures against; 0 = no budget set. */
  monthlyTokenBudget?: number
  /** ISO 4217 code the Budget tab's costs are shown in; token prices and plan costs are entered in this currency. */
  currency?: string
  /** Token prices per provider then model, in currency units per million tokens; a priceless route shows as unpriced, never estimated. */
  tokenPrices?: Record<string, Record<string, TokenPrice>>
  /** Monthly plan cost per subscription provider; `since` (YYYY-MM) starts the year-to-date count part-way through the year. */
  subscriptionCosts?: Record<string, SubscriptionPlan>
  /** Minutes a cached OpenRouter price list is trusted before the usage route re-reads the directory; 0 never fetches. */
  openRouterPriceRefreshMinutes?: number
  /** Minutes a cached fal usage report is trusted before the usage route re-reads it; 0 never fetches. */
  falUsageRefreshMinutes?: number
}

/** One model route's token prices, all four kinds explicit — no kind is ever assumed free. */
const TokenPriceSchema = z.object({
  input: z.number().min(0).required(),
  output: z.number().min(0).required(),
  cacheRead: z.number().min(0).required(),
  cacheWrite: z.number().min(0).required(),
})

/** One subscription's plan cost. */
const SubscriptionPlanSchema = z.object({
  monthly: z.number().min(0).required(),
  since: z.string().pattern(/^\d{4}-(?:0[1-9]|1[0-2])$/),
})

export const Config: z<ModelsConfig> = z.object({
  cost: z.number().min(0).max(100).default(34),
  speed: z.number().min(0).max(100).default(33),
  intelligence: z.number().min(0).max(100).default(33),
  mode: z.union(['manual', 'auto']).default('manual'),
  monthlyTokenBudget: z.natural().default(0),
  currency: z.string().pattern(/^[A-Z]{3}$/).default('USD'),
  tokenPrices: z.dict(z.dict(TokenPriceSchema)).default({}),
  subscriptionCosts: z.dict(SubscriptionPlanSchema).default({}),
  openRouterPriceRefreshMinutes: z.natural().default(1440),
  falUsageRefreshMinutes: z.natural().default(1440),
})

/** The subscription sign-in service's faces, as far as this plugin reads them. */
interface OAuthFace {
  store?: { list(): Promise<{ providerId: string }[]> }
  status?(): Promise<{ id: string; stored: boolean; keyless?: boolean }[]>
}

/**
 * The generation runtime's face, as far as this plugin reads it: which
 * credential each media backend is reached with. `@idealize/services` registers
 * those backends from its media directory, so this is the one place a media
 * key's name is declared.
 */
interface GenerationFace {
  credentials(): { backend: string; env: string }[]
}

interface AutoVerdict {
  at: string
  provider?: string
  model?: string
  reason: string
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export function apply(ctx: Context, config: ModelsConfig): void {
  let current: () => ModelsConfig = () => ({ ...config })
  let poke: () => void = () => {}
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source: () => ModelsConfig) => {
      current = source
    },
    onChange: () => {
      poke()
    },
  })

  ctx.inject(['webServer', 'llm', 'settings', 'credentials'], (webCtx) => {
    let lastAuto: AutoVerdict | undefined
    // One admin session on the engine, carried across policy passes.
    const engineKeys = createEngineKeyReader()

    /** The freetokens route + engine facts, read from the shared settings + engine API. */
    const freetokensFacts = async (): Promise<FreetokensFacts> => {
      const section = webCtx.settings.get(LLM_NS) as
        { providers?: { freetokens?: { baseURL?: string; models?: unknown[] } } } | undefined
      const route = section?.providers?.freetokens
      const routeModels = Array.isArray(route?.models) ? route.models.length : 0
      const origin = typeof route?.baseURL === 'string' ? route.baseURL.replace(/\/v1\/?$/, '') : undefined
      if (origin === undefined) return { routeModels, engineUp: false, usableKeys: undefined }
      let engineUp = false
      try {
        engineUp = (await fetch(origin, { signal: AbortSignal.timeout(3_000) })).status < 500
      } catch {
        // unreachable = not running
      }
      if (!engineUp) return { routeModels, engineUp, usableKeys: undefined }
      // Key headroom is only knowable when this host provisioned the engine.
      const password = await webCtx.credentials.resolve(credentialRef(FREETOKENS_ADMIN_PASSWORD_ENV))
      if (password === undefined) return { routeModels, engineUp, usableKeys: undefined }
      return { routeModels, engineUp, usableKeys: await engineKeys.usableKeys(origin, password.value) }
    }

    const decide = async (): Promise<PolicyDecision> => {
      const oauth = webCtx.get('idealizeOAuth') as OAuthFace | undefined
      const infos = oauth?.store === undefined
        ? []
        : await oauth.store.list().catch(() => [] as { providerId: string }[])
      const signedIn = infos.map(info => info.providerId)
      const codexModels = await webCtx.llm.listModels('openai-codex')
        .then(models => models.map(model => model.id))
        .catch(() => [] as string[])
      const prefs = current()
      return choose(
        { cost: prefs.cost ?? 34, speed: prefs.speed ?? 33, intelligence: prefs.intelligence ?? 33 },
        { freetokens: await freetokensFacts(), signedIn, models: { 'openai-codex': codexModels } },
      )
    }

    /** One policy pass: no-op unless mode is auto; only writes when the pick changes. */
    const evaluate = async (): Promise<void> => {
      if ((current().mode ?? 'manual') !== 'auto') return
      const decision = await decide()
      lastAuto = { at: new Date().toISOString(), reason: decision.reason, ...decision.choice ?? {} }
      if (decision.choice === undefined) return
      const standing = webCtx.settings.get(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) as AgentDefaultModelSettings | undefined
      if (standing !== undefined && standing.provider === decision.choice.provider && standing.model === decision.choice.model) return
      await webCtx.settings.update(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, decision.choice)
    }
    const evaluateSafely = (): void => {
      void evaluate().catch((error: unknown) => {
        lastAuto = {
          at: new Date().toISOString(),
          reason: `policy pass failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      })
    }
    poke = evaluateSafely

    webCtx.effect(() => {
      // The first pass waits out the mount window (provider directory and
      // freetokens registration both fill asynchronously).
      const first = setTimeout(evaluateSafely, 15_000)
      const timer = setInterval(evaluateSafely, EVALUATE_EVERY_MS)
      return () => {
        clearTimeout(first)
        clearInterval(timer)
        poke = () => {}
      }
    }, 'idealize-models: auto policy')

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
        `idealize-models: ${path}`,
      )
    }

    register('/idealize/models', false, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(modelsPage())
    })

    /** Subscription providers: offered through OAuth sign-in, with which are signed in. */
    const subscriptions = async (): Promise<{ offered: string[]; keyless: string[]; signedIn: string[] }> => {
      const oauth = webCtx.get('idealizeOAuth') as OAuthFace | undefined
      const none: { id: string; stored: boolean; keyless?: boolean }[] = []
      const rows = oauth?.status === undefined ? none : await oauth.status().catch(() => none)
      return {
        offered: rows.map(row => row.id),
        keyless: rows.filter(row => row.keyless === true).map(row => row.id),
        signedIn: rows.filter(row => row.stored).map(row => row.id),
      }
    }

    /**
     * How a route is paid for: the free engine, a stored API key profile
     * (a keyed profile wins over a catalogue OAuth offer — kimi-coding
     * offers both), or subscription sign-in. A route whose only auth is
     * sign-in reads as sign-in whatever its profile records: a key stored
     * for it could never have served it.
     */
    const authOf = (provider: string, subs: { offered: readonly string[]; keyless: readonly string[] }, apiKeyEnv: unknown): 'free' | 'oauth' | 'apiKey' => {
      if (provider === FREE_PROVIDER) return 'free'
      if (subs.keyless.includes(provider)) return 'oauth'
      if (typeof apiKeyEnv === 'string') return 'apiKey'
      return subs.offered.includes(provider) ? 'oauth' : 'apiKey'
    }
    const llmProfiles = (): Record<string, { apiKeyEnv?: unknown }> => {
      const section = webCtx.settings.get(LLM_NS) as { providers?: Record<string, { apiKeyEnv?: unknown }> } | undefined
      return section?.providers ?? {}
    }

    register('/idealize/models/state', false, async (_req, res) => {
      const subs = await subscriptions()
      const profiles = llmProfiles()
      const providers = await Promise.all(
        webCtx.llm.listConfigurableProviders().map(async (entry) => {
          const apiKeyEnv = profiles[entry.provider]?.apiKeyEnv
          const auth = authOf(entry.provider, subs, apiKeyEnv)
          const keyed = typeof apiKeyEnv === 'string'
            && (await webCtx.credentials.resolve(credentialRef(apiKeyEnv)).catch(() => undefined)) !== undefined
          const base = {
            provider: entry.provider,
            // The directory hands a catalogue route its id as its name; the
            // services table knows the company's own name.
            displayName: serviceName(entry.provider, entry.displayName),
            auth,
            // The free route's key only reaches its own engine; whether a
            // request can be answered is the engine's to say.
            connected: auth === 'oauth'
              ? subs.signedIn.includes(entry.provider)
              : keyed && (entry.provider !== FREE_PROVIDER || freeUsable(await freetokensFacts())),
            // Where the model list comes from: the route's own configuration
            // (a declared route, the free engine's registration), or the
            // catalogue the app ships and updates with itself.
            catalogue: entry.declared === true ? 'configured' as const : 'built-in' as const,
          }
          try {
            const models = await webCtx.llm.listModels(entry.provider)
            return { ...base, models: models.map(model => model.id) }
          } catch {
            // A route without usable credentials still belongs in the picker
            // header; it just lists nothing selectable yet.
            return { ...base, models: [] }
          }
        }),
      )
      const fallback = webCtx.settings.get(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE) as AgentDefaultModelSettings | undefined
      sendJson(res, 200, {
        providers,
        readAt: new Date().toISOString(),
        default: fallback === undefined ? undefined : { provider: fallback.provider, model: fallback.model },
        mode: current().mode ?? 'manual',
        auto: lastAuto,
        preferences: {
          cost: current().cost ?? 34,
          speed: current().speed ?? 33,
          intelligence: current().intelligence ?? 33,
        },
      })
    })

    register('/idealize/models/default', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { provider?: unknown; model?: unknown }
      if (typeof body.provider !== 'string' || body.provider === '' || typeof body.model !== 'string' || body.model === '') {
        sendJson(res, 400, { error: 'provider and model are required' })
        return
      }
      await webCtx.settings.update(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
        provider: body.provider,
        model: body.model,
      })
      // A hand-picked default is an instruction: auto stands down.
      if ((current().mode ?? 'manual') === 'auto') await webCtx.settings.update(NS, { mode: 'manual' })
      sendJson(res, 200, { ok: true })
    })

    register('/idealize/models/mode', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { mode?: unknown }
      if (body.mode !== 'manual' && body.mode !== 'auto') {
        sendJson(res, 400, { error: "mode must be 'manual' or 'auto'" })
        return
      }
      await webCtx.settings.update(NS, { mode: body.mode })
      if (body.mode === 'auto') await evaluate()
      sendJson(res, 200, { ok: true, mode: body.mode, auto: lastAuto })
    })

    register('/idealize/models/preferences', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as Record<string, unknown>
      const weight = (value: unknown): number | undefined =>
        typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : undefined
      const next = { cost: weight(body.cost), speed: weight(body.speed), intelligence: weight(body.intelligence) }
      if (next.cost === undefined || next.speed === undefined || next.intelligence === undefined) {
        sendJson(res, 400, { error: 'cost, speed and intelligence must each be numbers from 0 to 100' })
        return
      }
      await webCtx.settings.update(NS, next)
      evaluateSafely()
      sendJson(res, 200, { ok: true })
    })

    /**
     * OpenRouter's published prices, when they apply: the route has a stored
     * key, and costs are shown in USD, which is what OpenRouter prices in. A
     * disconnected route or another currency prices nothing automatically.
     */
    const openRouterPriceList = async (
      profiles: Record<string, { apiKeyEnv?: unknown }>,
      currency: string,
      refreshMinutes: number,
      now: number,
    ): ReturnType<typeof refreshOpenRouterPrices> => {
      if (currency !== 'USD') return undefined
      const apiKeyEnv = profiles[OPENROUTER_PROVIDER]?.apiKeyEnv
      if (typeof apiKeyEnv !== 'string') return undefined
      const key = await webCtx.credentials.resolve(credentialRef(apiKeyEnv)).catch(() => undefined)
      if (key === undefined) return undefined
      return refreshOpenRouterPrices({ home: resolveDshHome(), fetchImpl: fetch, maxAgeMs: refreshMinutes * 60_000, now })
    }

    /**
     * The prices the shipped catalogue publishes for the chat routes this home
     * has a profile for, in the currency pi-ai publishes them in. Another
     * currency leaves them out rather than converting a figure.
     */
    const cataloguePrices = (profiles: Record<string, { apiKeyEnv?: unknown }>, currency: string): TokenPriceTable => {
      if (currency !== SHIPPED_PRICE_CURRENCY) return {}
      const table: TokenPriceTable = {}
      for (const provider of Object.keys(profiles)) {
        const prices = shippedTokenPrices(provider)
        if (prices !== undefined) table[provider] = prices
      }
      return table
    }

    /**
     * What fal billed this year, when a key for it is stored. The generation
     * runtime names the credential fal is reached with. Until that runtime
     * carries a fal backend whose credential resolves, nothing is fetched and
     * the pane is told fal is not connected.
     */
    const falUsageReport = async (
      refreshMinutes: number,
      now: number,
    ): Promise<{ usage?: FalUsageCache; error?: string } | undefined> => {
      const generation = webCtx.get('generation') as GenerationFace | undefined
      const env = generation?.credentials().find(row => row.backend === FAL_PROVIDER)?.env
      if (env === undefined) return undefined
      const key = await webCtx.credentials.resolve(credentialRef(env)).catch(() => undefined)
      if (key === undefined) return undefined
      return refreshFalUsage({ home: resolveDshHome(), key: key.value, fetchImpl: fetch, maxAgeMs: refreshMinutes * 60_000, now })
    }

    /** Every top-level session's events: live agents first, then stored logs not currently live. */
    const sessionLogs = async (): Promise<{ id: string; cwd?: string; events: readonly SessionEvent[] }[]> => {
      const seen = new Set<string>()
      const logs: { id: string; cwd?: string; events: readonly SessionEvent[] }[] = []
      const agents = webCtx.get('agents')
      for (const agent of agents?.roots() ?? []) {
        const header = agent.session.header
        if (header.origin === 'subagent') continue
        seen.add(String(header.id))
        logs.push({ id: String(header.id), ...header.cwd === undefined ? {} : { cwd: header.cwd }, events: agent.session.events })
      }
      const persistence = webCtx.get('sessionPersistence')
      if (persistence === undefined) return logs
      for (const header of await persistence.list()) {
        if (header.origin === 'subagent' || seen.has(String(header.id))) continue
        try {
          const { events } = await persistence.inspect(header.id)
          logs.push({ id: String(header.id), ...header.cwd === undefined ? {} : { cwd: header.cwd }, events })
        } catch {
          // An unreadable log counts nothing; the Budget tab never blocks on one.
        }
      }
      return logs
    }

    register('/idealize/models/usage', false, async (req, res) => {
      const scope = new URL(req.url ?? '/', 'http://localhost').searchParams.get('scope') ?? ''
      const subs = await subscriptions()
      const profiles = llmProfiles()
      const subscribed = subs.offered.filter(provider => authOf(provider, subs, profiles[provider]?.apiKeyEnv) === 'oauth')
      const classify = (provider: string): ReturnType<typeof categoryOf> =>
        categoryOf(provider, { freeProvider: FREE_PROVIDER, subscriptionProviders: subscribed })
      const registry = webCtx.get('workspaceRegistry')
      const workspaces = registry?.list() ?? []
      const inScope = new Set<string>()
      const scoped = workspaces.find(workspace => workspace.path === scope)
      for (const id of scoped?.sessionIds ?? []) inScope.add(String(id))
      const now = Date.now()
      const periods = emptyUsagePeriods()
      const generated = emptyGenerationPeriods()
      for (const log of await sessionLogs()) {
        if (scope !== '' && !inScope.has(log.id) && log.cwd !== scope) continue
        foldUsage(log.events, classify, now, periods)
        foldGenerations(log.events, now, generated)
      }
      const config = current()
      const currency = config.currency ?? 'USD'
      const openRouter = await openRouterPriceList(profiles, currency, config.openRouterPriceRefreshMinutes ?? 1440, now)
      const prices = effectivePrices(config.tokenPrices ?? {}, openRouter?.prices, cataloguePrices(profiles, currency))
      const fal = await falUsageReport(config.falUsageRefreshMinutes ?? 1440, now)
      const generations = generationRows(generated, fal?.usage, now)
      sendJson(res, 200, {
        scope,
        projects: workspaces.map(workspace => ({ path: workspace.path, label: basename(workspace.path) })),
        month: periods.month,
        year: periods.year,
        monthlyTokenBudget: config.monthlyTokenBudget ?? 0,
        cost: costBreakdown(periods.models, classify, {
          currency,
          tokenPrices: prices,
          subscriptionPlans: config.subscriptionCosts ?? {},
          signedIn: subs.signedIn.filter(provider => subscribed.includes(provider)),
          now,
        }),
        models: modelRows(periods.models.month, classify, prices),
        openRouterPrices: openRouter === undefined
          ? null
          : { fetchedAt: openRouter.fetchedAt, models: Object.keys(openRouter.prices).length },
        generations: {
          rows: generations.rows,
          billed: generations.billed,
          // fal bills one account in one currency, and it is fal's own, so it
          // reaches the pane as fal sent it whatever currency the tab counts in.
          currency: generations.rows.find(row => row.billed !== undefined)?.billed?.currency ?? null,
        },
        falUsage: fal === undefined
          ? null
          : {
            fetchedAt: fal.usage?.fetchedAt ?? null,
            ...fal.error === undefined ? {} : { error: fal.error },
          },
      })
    })

    register('/idealize/models/prices', true, async (req, res) => {
      const parsed = parsePriceBody(JSON.parse(await readBody(req)))
      if (!parsed.ok) {
        sendJson(res, 400, { error: parsed.error })
        return
      }
      const { provider, model, price } = parsed.write
      if (price === null) {
        await webCtx.settings.mutate(NS, [{ op: 'unset', path: ['tokenPrices', provider, model] }])
      } else {
        await webCtx.settings.update(NS, { tokenPrices: { [provider]: { [model]: price } } })
      }
      sendJson(res, 200, { ok: true, ...parsed.write })
    })

    register('/idealize/models/budget', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { monthlyTokenBudget?: unknown }
      const value = body.monthlyTokenBudget
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        sendJson(res, 400, { error: 'monthlyTokenBudget must be a non-negative integer' })
        return
      }
      await webCtx.settings.update(NS, { monthlyTokenBudget: value })
      sendJson(res, 200, { ok: true, monthlyTokenBudget: value })
    })
  })
}
