/**
 * IDEalize feedback + announcements over a Supabase REST endpoint the
 * composition names. No project or key ships in the code: `endpoint` and
 * `publishableKey` come from the plugin config or the environment
 * (`IDEALIZE_FEEDBACK_ENDPOINT`, `IDEALIZE_FEEDBACK_KEY`); without both, a
 * submission is kept locally and the announcements feed is empty.
 *
 * HTTP surface (loopback-fenced; the submit route demands the header):
 * - POST /idealize/feedback/submit — {text, feedbackType?} proxied to the
 *   `idealize_feedback` table with app/os versions stamped, and appended to a
 *   local backup file in the Harness home regardless of network outcome.
 * - GET  /idealize/announcements — the newest active row of
 *   `idealize_announcements`, verbatim; the client owns version gating and
 *   dismissal, exactly as V0's banner did.
 *
 * The form itself is ui-bar's FeedbackPanel (a drawer pane); this package
 * serves no page of its own.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'

const V1_APP_VERSION = '1.0.0-dev'

/** Plugin config. */
export interface Config {
  /** Stamped into feedback rows as `app_version`; `IDEALIZE_APP_VERSION` (set by the desktop shell) when empty. */
  appVersion?: string
  /** The Supabase REST base URL (`https://<project>.supabase.co/rest/v1`); `IDEALIZE_FEEDBACK_ENDPOINT` when empty. */
  endpoint?: string
  /**
   * The project's publishable key, whose row-level security allows only
   * feedback inserts and announcement reads; `IDEALIZE_FEEDBACK_KEY` when empty.
   */
  publishableKey?: string
}

export const Config: z<Config> = z.object({
  appVersion: z.string().default(''),
  endpoint: z.string().default(''),
  publishableKey: z.string().default(''),
})

/** The upstream to talk to, from the config first and the environment second; undefined when either half is missing. */
function resolveUpstream(config: Config): { endpoint: string; key: string } | undefined {
  const endpoint = (config.endpoint ?? '').trim() || (process.env.IDEALIZE_FEEDBACK_ENDPOINT ?? '').trim()
  const key = (config.publishableKey ?? '').trim() || (process.env.IDEALIZE_FEEDBACK_KEY ?? '').trim()
  return endpoint === '' || key === '' ? undefined : { endpoint: endpoint.replace(/\/$/, ''), key }
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

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Append a timestamped backup entry under the Harness home. */
async function appendLocalBackup(text: string, feedbackType: string): Promise<void> {
  const file = join(resolveDshHome(), 'idealize-feedback-backup.md')
  await mkdir(dirname(file), { recursive: true })
  const stamp = new Date().toISOString()
  await appendFile(file, `\n## ${stamp} (${feedbackType})\n\n${text}\n`, 'utf8')
}

export function apply(ctx: Context, config: Config): void {
  const appVersion = (config.appVersion ?? '').trim() || (process.env.IDEALIZE_APP_VERSION ?? '').trim() || V1_APP_VERSION

  ctx.inject(['webServer'], (webCtx) => {
    const register = (
      path: string,
      mutating: boolean,
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
    ): void => {
      webCtx.effect(
        () => webCtx.webServer.register({
          kind: 'exact',
          path,
          handler: async (req, res) => {
            if (refuse(req, res, mutating)) return
            try {
              await handler(req, res)
            } catch (error) {
              res.writeHead(500, { 'content-type': 'application/json' })
                .end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
            }
          },
        }),
        `idealize-feedback: ${path}`,
      )
    }

    register('/idealize/feedback/submit', true, async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { text?: unknown; feedbackType?: unknown; screenshot?: unknown }
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const feedbackType = typeof body.feedbackType === 'string' && body.feedbackType !== '' ? body.feedbackType : 'feedback'
      if (text === '') {
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'text is required' }))
        return
      }
      // Plain base64 JPEG, V0's format; the table's CHECK caps the column at
      // 2M characters, so refuse oversized payloads here with a clear message.
      let screenshot: string | undefined
      if (typeof body.screenshot === 'string' && body.screenshot !== '') {
        if (body.screenshot.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(body.screenshot)) {
          res.writeHead(400, { 'content-type': 'application/json' })
            .end(JSON.stringify({ error: 'screenshot must be base64 under 2M characters' }))
          return
        }
        screenshot = body.screenshot
      }
      // The local backup always lands, network or not — V0's behaviour.
      await appendLocalBackup(text, feedbackType)
      const target = resolveUpstream(config)
      if (target === undefined) {
        res.writeHead(503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: 'no feedback service is configured', backedUpLocally: true }))
        return
      }
      const upstream = await fetch(`${target.endpoint}/idealize_feedback`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: target.key,
          authorization: `Bearer ${target.key}`,
          prefer: 'return=minimal',
        },
        body: JSON.stringify({
          text,
          feedback_type: feedbackType,
          app_version: appVersion,
          os_version: `${os.platform()} ${os.release()}`,
          ...(screenshot !== undefined ? { screenshot_b64: screenshot } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!upstream.ok) {
        res.writeHead(502, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: `the feedback service returned HTTP ${upstream.status}`, backedUpLocally: true }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }))
    })

    register('/idealize/announcements', false, async (_req, res) => {
      const target = resolveUpstream(config)
      if (target === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' }).end('[]')
        return
      }
      const upstream = await fetch(
        `${target.endpoint}/idealize_announcements?select=*&active=eq.true&order=created_at.desc&limit=1`,
        {
          headers: { apikey: target.key, authorization: `Bearer ${target.key}` },
          signal: AbortSignal.timeout(15_000),
        },
      )
      if (!upstream.ok) {
        res.writeHead(502, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: `the feedback service returned HTTP ${upstream.status}` }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(await upstream.text())
    })
  })
}
