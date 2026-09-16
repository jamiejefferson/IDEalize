/**
 * The IDEalize hatch: a maintenance surface over the cordis composition.
 * Shows every profile's layer stack (bundle patches → profile patch → home
 * patch) and the effective entry list they compose to, and lets the home
 * patch be edited safely: every save snapshots the previous content and
 * validates the new YAML through the same loader app-boot uses, and any
 * snapshot can be rolled back. Composition changes apply on restart.
 *
 * HTTP surface (loopback-fenced; mutations demand the header):
 * - GET  /idealize/hatch — the inspector page.
 * - GET  /idealize/hatch/composition — profiles, layers, effective entries.
 * - GET  /idealize/hatch/home-patch — the home patch file, verbatim.
 * - POST /idealize/hatch/home-patch — {content} validate + snapshot + save.
 * - GET  /idealize/hatch/snapshots — snapshot list, newest first.
 * - POST /idealize/hatch/rollback?name= — restore one snapshot (snapshotting
 *   the current content first, so a rollback is itself reversible).
 * - GET  /idealize/hatch/service — the service source checkout and whether it
 *   is already open as a project (V0's service-hatch half).
 * - POST /idealize/hatch/service — {path} validate the fork markers and
 *   persist the source into the settings user layer (applies immediately).
 * - POST /idealize/hatch/amend — open the service source as a project so an
 *   amend chat can start there; the repo's AGENTS.md briefs the agent.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { composeEntries, loadOverlayPatches, loadProfile, PROFILE_PATCH_FILENAME, PROFILES_DIR } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-workspace'

import { hatchPage } from './hatch-page.ts'
import { describeError, handleServiceRoute, readBody, resolveServiceSource, sendJson } from './service.ts'

const BIN = 'idealize-hatch'
const SNAPSHOT_DIR = 'hatch-snapshots'
const NS = settingsNamespace('idealize-hatch')

/** One profile's stack as the inspector reports it. */
interface ProfileView {
  name: string
  layers: { packageName: string; patchCount: number }[]
  profilePatchCount: number
  entries: string[]
  error?: string
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

/** The anchor bundle resolution falls back to: the running entrypoint's package. */
function installAnchor(): string {
  return dirname(process.argv[1] ?? process.cwd())
}

/** Validate candidate patch YAML by running it through the loader's parser. */
function validatePatchYaml(content: string): string | undefined {
  // An empty file is a valid (absent) home layer; the loader only accepts arrays.
  if (content.trim() === '') return undefined
  const probe = join(tmpdir(), `idealize-hatch-probe-${process.pid}.yml`)
  try {
    writeFileSync(probe, content, 'utf8')
    loadOverlayPatches(BIN, probe)
    return undefined
  } catch (error) {
    return describeError(error)
  }
}

/** ISO stamp safe for a filename. */
function snapshotName(): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}.yml`
}

/** Plugin config. */
export interface Config {
  /** Absolute path of the IDEalize source checkout the amend flow opens. */
  serviceSource?: string
}

export const Config: z<Config> = z.object({
  serviceSource: z.string(),
})

export function apply(ctx: Context, config: Config): void {
  // The settings user layer rides over the composed config, so the Service
  // tab's source edit takes effect on the next probe and survives restarts.
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
  })
  let writeSource: ((path: string) => Promise<void>) | undefined
  ctx.inject(['settings'], (sctx) => {
    sctx.effect(() => {
      writeSource = async (path) => { await sctx.settings.update(NS, { serviceSource: path }) }
      return () => { writeSource = undefined }
    }, 'idealize-hatch: service-source writer')
  })
  const home = resolveDshHome()
  const homePatchPath = join(home, PROFILE_PATCH_FILENAME)
  const snapshotDir = join(home, SNAPSHOT_DIR)

  const readHomePatch = (): string => existsSync(homePatchPath) ? readFileSync(homePatchPath, 'utf8') : ''

  const snapshotCurrent = (): string | undefined => {
    const current = readHomePatch()
    if (current === '') return undefined
    mkdirSync(snapshotDir, { recursive: true })
    const name = snapshotName()
    writeFileSync(join(snapshotDir, name), current, 'utf8')
    return name
  }

  const listSnapshots = (): string[] => {
    if (!existsSync(snapshotDir)) return []
    return readdirSync(snapshotDir).filter(name => name.endsWith('.yml')).sort().reverse()
  }

  const composition = (): { home: string; homePatchCount: number; profiles: ProfileView[] } => {
    const profilesDir = join(home, PROFILES_DIR)
    const names = existsSync(profilesDir)
      ? readdirSync(profilesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
      : []
    const homePatches = existsSync(homePatchPath) ? loadOverlayPatches(BIN, homePatchPath) : []
    const profiles = names.map((name): ProfileView => {
      try {
        const profile = loadProfile(BIN, name, installAnchor(), home)
        const entries = composeEntries(
          [...profile.layers.map(layer => layer.patches), profile.patches, homePatches],
        ).map(entry => entry.id)
        return {
          name,
          layers: profile.layers.map(layer => ({ packageName: layer.packageName, patchCount: layer.patches.length })),
          profilePatchCount: profile.patches.length,
          entries,
        }
      } catch (error) {
        return {
          name,
          layers: [],
          profilePatchCount: 0,
          entries: [],
          error: describeError(error),
        }
      }
    })
    return { home, homePatchCount: homePatches.length, profiles }
  }

  ctx.inject(['webServer', 'workspaceRegistry'], (webCtx) => {
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
              sendJson(res, 500, { error: describeError(error) })
            }
          },
        }),
        `idealize-hatch: ${path}`,
      )
    }

    register('/idealize/hatch', false, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(hatchPage())
    })

    register('/idealize/hatch/composition', false, (_req, res) => {
      sendJson(res, 200, composition())
    })

    register('/idealize/hatch/home-patch', false, async (req, res) => {
      if (req.method === 'POST') {
        if (req.headers['x-idealize-auth'] !== '1') {
          res.writeHead(403, { 'content-type': 'text/plain' }).end('missing x-idealize-auth header')
          return
        }
        const body = JSON.parse(await readBody(req)) as { content?: unknown }
        const content = typeof body.content === 'string' ? body.content : undefined
        if (content === undefined) {
          sendJson(res, 400, { error: 'content is required' })
          return
        }
        const invalid = validatePatchYaml(content)
        if (invalid !== undefined) {
          sendJson(res, 422, { error: `patch rejected: ${invalid}` })
          return
        }
        const snapshot = snapshotCurrent()
        // Boot rejects an existing-but-empty patch file, so emptying the
        // layer means removing the file (an absent layer is the valid form).
        if (content.trim() === '') {
          if (existsSync(homePatchPath)) unlinkSync(homePatchPath)
        } else {
          writeFileSync(homePatchPath, content, 'utf8')
        }
        sendJson(res, 200, { ok: true, ...snapshot === undefined ? {} : { snapshot }, note: 'restart applies the change' })
        return
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(readHomePatch())
    })

    register('/idealize/hatch/snapshots', false, (_req, res) => {
      sendJson(res, 200, listSnapshots())
    })

    // The V0 service-hatch half: where the app's own source lives, whether it
    // is already open as a project, and (POST) pointing it somewhere else.
    register('/idealize/hatch/service', false, (req, res) => handleServiceRoute({
      currentSource: () => current().serviceSource,
      writeSource: () => writeSource,
      resolveWorkspace: path => webCtx.workspaceRegistry.resolveByPath(path),
    }, req, res))

    // Open the service source as a project so an amend chat can start there.
    // The repo's own AGENTS.md briefs the agent on the fork's rules.
    register('/idealize/hatch/amend', true, async (_req, res) => {
      const source = resolveServiceSource(current().serviceSource)
      if (!source.valid) {
        sendJson(res, 422, {
          error: `no service checkout at ${source.path} (needs FORK.md + package.json); edit the source path on the Service tab`,
        })
        return
      }
      const existing = await webCtx.workspaceRegistry.resolveByPath(source.path)
      if (existing !== undefined) {
        sendJson(res, 200, { ok: true, workspaceId: existing.id, path: source.path, created: false })
        return
      }
      const workspace = await webCtx.workspaceRegistry.create(source.path)
      sendJson(res, 200, { ok: true, workspaceId: workspace.id, path: source.path, created: true })
    })

    register('/idealize/hatch/rollback', true, (req, res) => {
      const name = new URL(req.url ?? '/', 'http://localhost').searchParams.get('name') ?? ''
      // basename() guards traversal; the extension pin keeps it inside the set.
      if (name === '' || basename(name) !== name || !name.endsWith('.yml')) {
        sendJson(res, 400, { error: 'name must be a snapshot filename' })
        return
      }
      const file = join(snapshotDir, name)
      if (!existsSync(file)) {
        sendJson(res, 404, { error: 'no such snapshot' })
        return
      }
      const snapshot = snapshotCurrent()
      writeFileSync(homePatchPath, readFileSync(file, 'utf8'), 'utf8')
      sendJson(res, 200, { ok: true, restored: name, ...snapshot === undefined ? {} : { previousSavedAs: snapshot } })
    })
  })
}
