/**
 * Asks the person before a chat runs a script in a Hatch page or moves Hatch to
 * a new site. Hatch's canvases can be logged in, and text inside a page reaches
 * the chat, so a hidden instruction on a page could have the chat read a
 * logged-in page with `evaluate` and then visit an attacker's address with the
 * data in the link. Saved passwords already ask, in Hatch itself.
 *
 * This runs on the "ask" approval setting only. A chat on Full access has chosen
 * not to be asked, and an ask there would be rejected outright. A place the person
 * allowed stays allowed for that chat until the app restarts, and the machine's
 * own dev servers and a chat's own project never ask.
 *
 * Tools live on the host, so generating chats (Images, Sounds, Video) hold these
 * too, and the gate covers them. A click on a page's own link, and a page's own
 * scripts, stay outside it, because Hatch alone sees where those lead.
 *
 * Turn it off with `browserGate: false` on the Hatch entry in the composition.
 *
 * @module @deepseek-ai/dsh-mcp-client/browser-gate
 */

import { isAbsolute, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** The MCP server this gate watches. */
export const BROWSER_SERVER = 'hatch'

/** The tools that take an address in `to`. */
const MOVES_BY_ADDRESS = new Set(['navigate', 'open_hatch'])

/** Where an address leads, as the gate judges it. */
type Destination =
  /** Stays on this machine's dev servers, in a Hatch project, or inside the chat's folder. */
  | { kind: 'home' }
  /** A web site, by host name. */
  | { kind: 'site'; host: string }
  /** Anything else: a file elsewhere, another scheme, or a saved link's title. */
  | { kind: 'other'; label: string }

const LOCAL_HOST = /^(localhost|127(\.\d+){3}|\[::1\]|0\.0\.0\.0|.+\.localhost)$/i

function siteOf(url: URL): Destination {
  const host = url.hostname.toLowerCase()
  return LOCAL_HOST.test(host) ? { kind: 'home' } : { kind: 'site', host: host.replace(/^www\./, '') }
}

/**
 * Judge one address in any form Hatch takes: a `hatch:` project address, a full
 * link, a bare domain, an absolute path, or the title of a saved link.
 * @param to - the address.
 * @param cwd - the chat's working folder.
 * @returns where it leads.
 */
export function destinationOf(to: string, cwd: string | undefined): Destination {
  const address = to.trim()
  if (/^hatch:[\w-]/i.test(address)) return { kind: 'home' }
  if (isAbsolute(address) || address.startsWith('~')) {
    const inside = cwd !== undefined && !address.includes('..') && (address === cwd || address.startsWith(cwd.endsWith(sep) ? cwd : cwd + sep))
    return inside ? { kind: 'home' } : { kind: 'other', label: address }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) {
    try {
      const url = new URL(address)
      if (url.protocol === 'http:' || url.protocol === 'https:') return siteOf(url)
    } catch {
      // An address that does not parse is judged by its words below.
    }
    return { kind: 'other', label: address }
  }
  // `javascript:`, `data:` and the like name no site; `example.com:8080` does.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(address)) return { kind: 'other', label: address }
  if (/^[^\s/]+\.[^\s/]+(:\d+)?(\/\S*)?$/.test(address) || /^localhost(:\d+)?(\/\S*)?$/i.test(address)) {
    try {
      return siteOf(new URL(`https://${address}`))
    } catch {
      return { kind: 'other', label: address }
    }
  }
  return { kind: 'other', label: address }
}

/** The approval setting a session's log last chose; undefined when it never chose. */
function approvalSetting(events: readonly { type: string; data?: unknown }[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'approval/policy') return (event.data as { policy?: string }).policy
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

/** Every address one call moves to. */
function addressesOf(rawName: string, args: Record<string, unknown>): string[] {
  if (MOVES_BY_ADDRESS.has(rawName)) return typeof args.to === 'string' ? [args.to] : []
  if (rawName !== 'run_steps' || !Array.isArray(args.steps)) return []
  return args.steps.flatMap((step) => {
    const { do: action, to } = asRecord(step)
    return action === 'navigate' && typeof to === 'string' ? [to] : []
  })
}

/** Whether an address is one the chat was already allowed, or a site beneath one. */
function known(host: string, allowed: ReadonlySet<string>): boolean {
  for (const site of allowed) if (host === site || host.endsWith(`.${site}`)) return true
  return false
}

const SCRIPT_PREVIEW = 300

/**
 * Register the gate.
 * @param ctx - the plugin context.
 * @param serverName - the MCP server this client connects to.
 */
export function installBrowserGate(ctx: Context, serverName: string): void {
  const prefix = `mcp__${serverName}__`
  /** Sites each chat has been allowed, and what a call in flight will add when it succeeds. */
  const allowed = new Map<string, Set<string>>()
  const pending = new WeakMap<ToolExecution, string[]>()

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    // Every other gate has its say first, so a refusal stays a refusal.
    const decided = await next()
    if (decided.kind !== 'allow' || !exec.name.startsWith(prefix) || exec.agent === undefined) return decided
    const { session } = exec.agent
    const fallback = (ctx.get('approval') as { config?: { policy?: string } } | undefined)?.config?.policy
    if ((approvalSetting(session.events) ?? fallback ?? 'ask') !== 'ask') return decided
    const rawName = exec.name.slice(prefix.length)
    const args = asRecord(exec.arguments)
    if (rawName === 'evaluate') {
      const script = typeof args.expression === 'string' ? args.expression.slice(0, SCRIPT_PREVIEW) : ''
      return {
        kind: 'ask',
        reason: `This chat wants to run a script in the page open in Hatch. It can read what the page shows, including anything you are logged in to. The script: ${script}`,
      }
    }
    const seen = allowed.get(String(session.id)) ?? new Set<string>()
    const asking: string[] = []
    const remember: string[] = []
    for (const address of addressesOf(rawName, args)) {
      const destination = destinationOf(address, session.header.cwd)
      if (destination.kind === 'home') continue
      const key = destination.kind === 'site' ? destination.host : destination.label
      if (known(key, seen)) continue
      asking.push(address)
      remember.push(key)
    }
    if (asking.length === 0) return decided
    pending.set(exec, remember)
    return {
      kind: 'ask',
      reason: `This chat wants to take Hatch to a new place: ${asking.join(', ')}. A link can carry what the chat has read, so allow it only if you expected this.`,
    }
  })

  ctx.on('tools/post-execute', (exec: ToolExecution, result: { isError?: boolean }, next: () => Promise<never>) => {
    const sites = pending.get(exec)
    if (sites !== undefined && exec.agent !== undefined && result.isError !== true) {
      const id = String(exec.agent.session.id)
      const seen = allowed.get(id) ?? new Set<string>()
      for (const site of sites) seen.add(site)
      allowed.set(id, seen)
    }
    return next()
  })
}
