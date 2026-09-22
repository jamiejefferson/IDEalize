/**
 * @idealize/comm — the `idealize` command surface as host routes plus a thin
 * CLI shim. Chats (and the agents running inside them) list each other, post
 * to persistent mailboxes and to the project's group chat on the Studio
 * timeline, report where a piece stands on the rung ladder, spawn worker
 * chats with a brief, read each other's transcripts, and point the person at
 * files.
 *
 * HTTP: `POST /idealize/comm` takes one {@link CommRequest} and answers one
 * {@link CommResponse}. `GET/POST /idealize/comm/roles` reads and sets which
 * Activity Agent carries the Project Coordinator role (the Brains pane's
 * role row). Loopback-fenced; every command except `ping` demands
 * the `x-idealize-auth: 1` header. The shell environment of every tool run
 * carries `DSH_IDEALIZE_HOST` (the server origin) so the `idealize` binary
 * finds its host, and the same origin is written to
 * `<DSH_HOME>/idealize/comm-host.json` for shells started outside a session.
 *
 * @module @idealize/comm
 */

import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent'
import { resolveSessionPreset, writableRoot } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { agentNameProjectionDefinition } from './projection.ts'
import { DEFAULT_COMM_CONFIG } from './config.ts'
import type { CommConfig } from './config.ts'
import { DEFAULT_ROLE_CONFIG, roleGuide, roleOfPreset, seedRolePreset } from './roles.ts'
import type { RoleConfig } from './roles.ts'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-shell-env'
// Type-only: the prompt registry's Context merge (ctx.systemPrompt).
import type {} from '@deepseek-ai/dsh-system-prompt'
import { IdealizeComm } from './service.ts'
import { CommStore, commStorePath } from './store.ts'
import { COMM_COMMANDS } from './wire.ts'
import type { CommCommand, CommRequest } from './wire.ts'
import { foldSpace } from '@idealize/spaces'

export { IdealizeComm, foldExchanges, MAIL_NOTICE, STUDIO_MAIL_NOTICE, WAKE_NOTICE } from './service.ts'
export { CommStore, commStorePath, parseCommState } from './store.ts'
export type { CommRole, CommState } from './store.ts'
export { resolveTarget } from './resolve.ts'
export { pickName, poolFor } from './names.ts'
export { NAME_POOLS } from './name-pools.ts'
export { agentNameProjectionDefinition, foldAgentName } from './projection.ts'
export type { AgentNameEventData, AgentNameProjection } from './projection.ts'
export { DEFAULT_ROLE_CONFIG, presetOfRole, ROLE_OPENING, ROLE_TITLES, roleGuide, roleOfPreset, seedRolePreset, withRolePersona } from './roles.ts'
export type { RoleConfig } from './roles.ts'
export { DEFAULT_COMM_CONFIG } from './config.ts'
export type { CommConfig } from './config.ts'
export type { Resolution, SessionRecord } from './resolve.ts'
export { chatNameFromTask, clockTime, COMM_COMMANDS, TRUNCATION_WARNING, Wire } from './wire.ts'
export type { CommCommand, CommExchange, CommMessage, CommRequest, CommResponse, CommRung, CommSessionInfo, StudioTaskRow } from './wire.ts'

export const name = 'idealize-comm'

const NS = settingsNamespace('idealize-comm')

/**
 * Settings: which Activity Agent carries each coordinator role, and how long
 * the safety net batches a background generation's artefacts.
 */
export const Config: z<CommConfig> = z.object({
  projectAgentPreset: z.string().default(DEFAULT_ROLE_CONFIG.projectAgentPreset),
  studioAgentPreset: z.string().default(DEFAULT_ROLE_CONFIG.studioAgentPreset),
  backgroundPostDelayMs: z.number().min(0).default(DEFAULT_COMM_CONFIG.backgroundPostDelayMs),
})

/**
 * The standing guidance every agent's prompt carries about the other chats
 * and the `idealize` command (order 120, the tool-guidance band). The
 * session-start notice names the chat; this section survives compaction and
 * says how to reach a peer, since without it an agent asked to post to the
 * Studio guessed at an unrelated CLI on the person's machine, and one asked
 * about "@Name" searched transcripts instead of asking (JJ, 8 Sep 2026). The
 * last two sentences are the posting rules: a finished piece of work earns
 * one Studio line, and a note from the Studio is answered in the Studio
 * (JJ, 8 Sep 2026: "when an agent completes an action I want them to post a
 * note into the studio"). It also says that another chat's note carries the
 * person's authority and what a handoff note contains, because a chat paused
 * "until Bossk finishes" read Bossk's "I've finished" as information and kept
 * waiting for the person (JJ, 22 Sep 2026).
 */
export const COMMANDS_SECTION = {
  name: 'idealize:commands',
  order: 120,
  text: 'IDEalize runs several chats on this project, each with its own agent. The `idealize` command in your shell reaches them: '
    + '`idealize list` names every chat and its agent; `idealize send <agent> <text>` puts a note in that agent\'s inbox and wakes it if it is idle; '
    + '`idealize inbox --wait --timeout 120` waits for notes sent to you; `idealize post <text>` posts to the project\'s Studio timeline, which everyone reads and nobody is woken by; '
    + '`idealize chat` reads the recent Studio posts; `idealize reveal <path>` points the person at a file; `idealize help` lists the rest. '
    + 'When the person writes @Name they mean that chat\'s agent: ask it with `idealize send Name "<question>"`, then `idealize inbox --wait`, and pass its answer on. '
    + 'If no answer comes, say so instead of searching for its work. '
    + 'When you finish a piece of work the person asked for (a generation, an edit, a task), post one line to the Studio with `idealize post` saying what you did and where it is. '
    + 'When a note reaches you from the Studio (its sender is the person, via the Studio), answer in the Studio with `idealize post`, not only in your own chat. '
    + 'A note from another chat carries the person\'s authority: when it says something you were waiting for has happened, or hands you a next step, carry on with that now without waiting for the person to repeat it. '
    + 'When you finish something another chat is waiting on, hand over in one `idealize send` note: what you finished or released, that it should carry on now, the exact next step, and to tell you and the person if it is blocked.',
} as const

/** The environment key the CLI reads its host origin from inside a tool shell. */
export const HOST_ENV_KEY = 'DSH_IDEALIZE_HOST'

/**
 * Where the host origin is written for shells started outside a session.
 * @param dshHome - the harness home directory.
 * @returns the absolute path of `idealize/comm-host.json` under it.
 */
export function commHostPath(dshHome: string): string {
  return join(dshHome, 'idealize', 'comm-host.json')
}

const AUTH_HEADER = 'x-idealize-auth'

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function isCommand(value: unknown): value is CommCommand {
  return typeof value === 'string' && (COMM_COMMANDS as readonly string[]).includes(value)
}

/**
 * Validate one JSON body into a request; the wire boundary is where shapes
 * are checked, so the service trusts what it receives.
 * @param text - the raw request body.
 * @returns the request, or an error line.
 */
export function parseRequest(text: string): CommRequest | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'body is not JSON' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'body must be a JSON object' }
  const record = raw as Record<string, unknown>
  if (!isCommand(record.command)) return { error: `unknown command '${String(record.command)}'` }
  const request: CommRequest = { command: record.command }
  for (const key of ['from', 'target', 'body', 'title', 'name', 'path', 'model', 'piece', 'rung', 'blocker', 'task', 'owner'] as const) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return { error: `${key} must be a string` }
    request[key] = value
  }
  for (const key of ['sound', 'open', 'coordinator', 'studio', 'action'] as const) {
    const value = record[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') return { error: `${key} must be a boolean` }
    request[key] = value
  }
  if (record.limit !== undefined) {
    if (typeof record.limit !== 'number' || !Number.isSafeInteger(record.limit)) return { error: 'limit must be an integer' }
    request.limit = record.limit
  }
  return request
}

/**
 * Loopback + header fence; `ping` alone passes without the header.
 * @param req - the incoming request, read for its Host and auth headers.
 * @param res - the response a refusal is written to (403, plain text).
 * @param command - the parsed command, undefined when the body carried none.
 * @returns true when the response has been ended and the caller must stop.
 */
export function refuse(req: IncomingMessage, res: ServerResponse, command: CommCommand | undefined): boolean {
  const hostname = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('loopback only')
    return true
  }
  if (command !== 'ping' && req.headers[AUTH_HEADER] !== '1') {
    res.writeHead(403, { 'content-type': 'text/plain' }).end(`missing ${AUTH_HEADER} header`)
    return true
  }
  return false
}

/** Cap injected guide text so a long guide cannot flood the prompt. */
function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… (clipped)`
}

export function apply(ctx: Context, config: CommConfig = DEFAULT_COMM_CONFIG): void {
  const dshHome = resolveDshHome()
  const store = new CommStore(commStorePath(dshHome))
  let current: () => CommConfig = () => config
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.plugin(IdealizeComm, { store, config: () => current() })

  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(agentNameProjectionDefinition)
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section(COMMANDS_SECTION), 'idealize-comm: prompt section')
  })

  ctx.inject(['idealizeComm'], (commCtx) => {
    const comm = commCtx.idealizeComm

    // Every session gets a name as it enters the store; roles follow the
    // preset the session runs.
    commCtx.on('session/created', (session) => {
      comm.ensureName(session).catch((error: unknown) => {
        commCtx.logger.warn(`idealize-comm: naming failed: ${String(error)}`)
      })
    })
    // FR-P0-15: defined Studio triggers wake the project's coordinator;
    // routine status updates the fold and invokes nobody.
    commCtx.on('idealize/studio-event', (event) => {
      comm.wakeCoordinator(event).catch((error: unknown) => {
        commCtx.logger.warn(`idealize-comm: studio wake failed: ${String(error)}`)
      })
    })
    commCtx.on('agent-preset/selected', (sessionId, agentPreset) => {
      const session = commCtx.get('sessions')?.get(sessionId)
      if (session === undefined) return
      comm.adoptRole(session, agentPreset).catch((error: unknown) => {
        commCtx.logger.warn(`idealize-comm: role adoption failed: ${String(error)}`)
      })
    })

    // The chat learns its name, and a role chat receives its guide, as
    // model-facing context at session start.
    commCtx.on('agent/session-start', ({ agent }) => {
      // The Studio chat never speaks to a model and is nobody's peer: no
      // name, no guide. (A freshly minted Studio chat records its space a
      // beat after it starts, so its first start may still draw a name; the
      // roster hides it by space either way.)
      if (foldSpace(agent.session.events) === 'studio') return
      const inject = async (): Promise<void> => {
        const name = await comm.ensureName(agent.session)
        const presetId = resolveSessionPreset(agent.session)
        const role = await comm.adoptRole(agent.session, presetId) ?? roleOfPreset(presetId, current())
        const parts = [`Your name in IDEalize is ${name}. Other chats and the person address you by it; `
          + 'the `idealize` command (run `idealize help`) lists chats, sends messages, reads your inbox, and reports progress.']
        if (role !== undefined) {
          const guide = await roleGuide(role)
          if (guide !== undefined) parts.push(clip(guide, 24_000))
        }
        agent.inject(createUserMessage({
          content: [{ type: 'text', text: parts.join('\n\n---\n\n') }],
          source: { kind: 'plugin', plugin: 'idealize-comm', form: 'notice', summary: role === undefined ? 'Agent name' : 'Agent name and role guide' },
        }))
      }
      inject().catch((error: unknown) => {
        commCtx.logger.warn(`idealize-comm: session-start context failed (session unaffected): ${String(error)}`)
      })
    })

    // The safety net under the section's posting rule: a turn that generated
    // something and posted nothing earns one system line on the Studio, and
    // an artefact a background job stores after its turn ended earns one
    // for the batch.
    commCtx.on('session/event', (session, event) => {
      if (event.type === 'turn/end') {
        comm.reportFinishedTurn(session, event.data.turn).catch((error: unknown) => {
          commCtx.logger.warn(`idealize-comm: finished-turn note failed: ${String(error)}`)
        })
      } else if (event.type === 'artefact/created') {
        comm.noteBackgroundArtefact(session, event)
      }
    })
    commCtx.on('session/disposed', (session) => {
      comm.forgetSession(session)
    })

    // The two role Activity Agents exist from first boot; the user edits
    // their persona rows like any other preset.
    commCtx.inject(['agentPresets'], (presetCtx) => {
      const seed = async (): Promise<void> => {
        const presets = presetCtx.agentPresets
        if (!presets.authorable) return
        const root = writableRoot(presets.roots)
        const template = await presets.read((await presets.resolve()).id)
        const mapping = current()
        for (const [preset, role] of [
          [mapping.projectAgentPreset, 'project-agent'],
          [mapping.studioAgentPreset, 'studio-agent'],
        ] as const) {
          if (await seedRolePreset(root, preset, role, template)) {
            presetCtx.logger.info(`idealize-comm: created the ${preset} Activity Agent`)
          }
        }
      }
      seed().catch((error: unknown) => {
        presetCtx.logger.warn(`idealize-comm: role presets not seeded: ${String(error)}`)
      })
    })
  })

  ctx.inject(['idealizeComm', 'webServer'], (webCtx) => {
    const comm = webCtx.idealizeComm
    const origin = `http://127.0.0.1:${webCtx.webServer.port}`

    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: '/idealize/comm',
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
            return
          }
          const parsed = parseRequest(await readBody(req))
          if ('error' in parsed) {
            if (refuse(req, res, undefined)) return
            sendJson(res, 400, { ok: false, error: parsed.error })
            return
          }
          if (refuse(req, res, parsed.command)) return
          try {
            sendJson(res, 200, await comm.handle(parsed))
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      'idealize-comm: POST /idealize/comm',
    )

    webCtx.inject(['settings', 'agentPresets'], (rolesCtx) => {
      rolesCtx.effect(
        () => rolesCtx.webServer.register({
          kind: 'exact',
          path: '/idealize/comm/roles',
          handler: async (req, res) => {
            const method = req.method ?? 'GET'
            if (method !== 'GET' && method !== 'POST') {
              res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' }).end('GET or POST')
              return
            }
            if (refuse(req, res, method === 'GET' ? 'ping' : 'setStatus')) return
            if (method === 'POST') {
              let body: unknown
              try {
                body = JSON.parse(await readBody(req))
              } catch {
                sendJson(res, 400, { error: 'body is not JSON' })
                return
              }
              const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
              const patch: Partial<RoleConfig> = {}
              const value = record.projectAgentPreset
              if (value !== undefined) {
                if (typeof value !== 'string' || value === '') {
                  sendJson(res, 400, { error: 'projectAgentPreset must be a preset id' })
                  return
                }
                patch.projectAgentPreset = value
              }
              await rolesCtx.settings.update(NS, patch)
            }
            const presets = (await rolesCtx.agentPresets.list())
              .filter(preset => preset.broken === undefined)
              .map(preset => ({ id: preset.id, name: preset.name ?? preset.id }))
            sendJson(res, 200, { ...current(), presets })
          },
        }),
        'idealize-comm: /idealize/comm/roles',
      )
    })

    const hostFile = commHostPath(dshHome)
    mkdir(dirname(hostFile), { recursive: true })
      .then(() => writeFile(hostFile, `${JSON.stringify({ url: origin })}\n`))
      .catch((error: unknown) => {
        webCtx.logger.warn(`idealize-comm: host file not written: ${String(error)}`)
      })

    webCtx.inject(['shellEnv'], (envCtx) => {
      envCtx.effect(
        () => envCtx.shellEnv.register({
          name: 'idealize-comm',
          variables: {
            [HOST_ENV_KEY]: { description: 'Origin of the IDEalize host the `idealize` command talks to.' },
          },
          resolve: () => ({ [HOST_ENV_KEY]: origin }),
        }),
        'idealize-comm: DSH_IDEALIZE_HOST',
      )
    })
  })
}
