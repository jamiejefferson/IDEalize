/**
 * The IDEalize host bridge: `ctx.idealizeBridge`, one place where the host
 * turns "something a person cares about happened" into a feed a shell can
 * surface as toasts and badges — the Electron desktop app and the plain
 * browser tab read the same feed.
 *
 * Sources: `idealize/cron-run` and `idealize/cron-changed` (from
 * @idealize/cron; the latter tells the Schedule pane to refetch), `agent/status` idle
 * transitions after a running spell, `agent/error`, and the approval
 * waterfall observed pass-through (pending + decided, never deciding).
 * The command surface (@idealize/comm) pushes `mail`, `notify`, `focus`, and
 * `reveal` events into the same buffer; the Askbar (@idealize/askbar) pushes
 * `open-studio` when its Group chat button asks the main window for a
 * project's Studio chat.
 *
 * HTTP surface (loopback-fenced, read-only):
 * - GET /idealize/events/recent?since=<seq> — retained events after the cursor.
 * - GET /idealize/events/stream — SSE; one `data:` JSON line per event.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@idealize/cron'

import { BridgeBuffer } from './buffer.ts'
import type { BridgeEvent } from './buffer.ts'

export { BridgeBuffer } from './buffer.ts'
export type { BridgeEvent, BridgeEventKind } from './buffer.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    idealizeBridge: IdealizeBridge
  }
}

/** The notification feed behind `ctx.idealizeBridge`: a capped buffer plus its HTTP surface. */
export class IdealizeBridge extends Service {
  /** The retained feed the HTTP routes read and the producers push into. */
  readonly buffer: BridgeBuffer = new BridgeBuffer()
  /** Agents currently in a running spell; an idle flip for one is a finish. */
  private readonly runningAgents = new WeakSet<Agent>()

  constructor(ctx: Context) {
    super(ctx, 'idealizeBridge')

    ctx.on('idealize/cron-run', (run, task) => {
      const took = run.durationMs === undefined ? '' : ` in ${(run.durationMs / 1000).toFixed(1)}s`
      this.buffer.push({
        kind: 'cron-run',
        title: `${task.name} — ${run.status}${took}`,
        body: run.detail ?? '',
        ...run.sessionId === undefined ? {} : { sessionId: run.sessionId },
      })
    })

    ctx.on('idealize/cron-changed', () => {
      this.buffer.push({ kind: 'cron-changed', title: 'Calendar changed', body: '' })
    })

    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'running') {
        this.runningAgents.add(agent)
        return
      }
      if (!this.runningAgents.has(agent)) return
      this.runningAgents.delete(agent)
      // A turn that ended on an error left no reply. The event stays
      // `agent-finished` so every surface refreshes and the chime sounds, and
      // says so, so the notification does not promise a reply (PC test drive,
      // 18 Sep 2026: "A reply is ready for you" over an empty conversation).
      const ended = agent.session.events.findLast(event => event.type === 'turn/end')
      const failed = ended?.type === 'turn/end' && ended.data.reason.kind === 'error'
      this.buffer.push({
        kind: 'agent-finished',
        title: failed ? 'Agent stopped on an error' : 'Agent finished',
        body: '',
        sessionId: String(agent.session.header.id),
        ...failed ? { failed: true } : {},
      })
    })

    ctx.on('agent/error', ({ agent, error }) => {
      this.buffer.push({
        kind: 'agent-error',
        title: 'Agent hit an error',
        body: error instanceof Error ? error.message : String(error),
        sessionId: String(agent.session.header.id),
      })
    })

    // Observe the approval chain without ever answering: record the ask,
    // delegate with next(), record what the real answerers decided.
    ctx.on('approval/request', async (req, next) => {
      const pending = this.buffer.push({
        kind: 'approval-pending',
        title: `Approval needed: ${req.toolName}`,
        body: req.reason ?? '',
        sessionId: String(req.agent.session.header.id),
      })
      const outcome = await next()
      this.buffer.push({
        kind: 'approval-decided',
        title: `Approval ${outcome === 'allowed-once' ? 'granted' : outcome}: ${req.toolName}`,
        body: `answers the ask at seq ${pending.seq}`,
        sessionId: String(req.agent.session.header.id),
      })
      return outcome
    })
  }
}

/** Loopback fence — the feed is read-only, so no header demand. */
function refuse(req: IncomingMessage, res: ServerResponse): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  return false
}

export function apply(ctx: Context): void {
  ctx.plugin(IdealizeBridge)
  ctx.inject(['idealizeBridge', 'webServer'], (webCtx) => {
    const bridge = webCtx.idealizeBridge

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/events/recent',
        handler: (req, res) => {
          if (refuse(req, res)) return
          const since = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('since') ?? '0')
          const events = bridge.buffer.recent(Number.isSafeInteger(since) && since >= 0 ? since : 0)
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(events))
        },
      }),
      'idealize-bridge: /idealize/events/recent',
    )

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/events/stream',
        handler: (req, res) => {
          if (refuse(req, res)) return
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          })
          res.write(': idealize bridge stream\n\n')
          const send = (event: BridgeEvent): void => {
            res.write(`data: ${JSON.stringify(event)}\n\n`)
          }
          const since = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('since') ?? '0')
          for (const event of bridge.buffer.recent(Number.isSafeInteger(since) && since >= 0 ? since : 0)) send(event)
          const detach = bridge.buffer.subscribe(send)
          req.on('close', detach)
        },
      }),
      'idealize-bridge: /idealize/events/stream',
    )
  })
}
