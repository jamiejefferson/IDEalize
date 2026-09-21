/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * vendored Loader mounts storage, sessions, persistence, workspaces, the
 * webserver, and the artefact store; assertions observe the durable record,
 * the session log (create → artefact/created with the ignorable envelope),
 * the raw route's 200/403/404 answers, and the artefacts_get tool value.
 */

import { createHash } from 'node:crypto'
import { get as httpGet, request as httpRequest } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { CallId } from '@deepseek-ai/dsh-llm/brand'
import ArtefactStore, { ARTEFACT_SETTINGS_NAMESPACE, ArtefactId, createArtefactsGetTool, describeFolders, FOLDERS_SECTION } from '../src/index.ts'
import type { ArtefactCreateRequest, ArtefactRecord } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/**
 * Boot the artefact composition through the real Loader over a temp root;
 * `withSettings` adds the file-backed settings provider so the folder section
 * has a store.
 */
async function loadComposition(withSettings = false): Promise<{ ctx: Context; projectDir: string; port: number }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-artefacts-'))
  const projectDir = join(root, 'project')
  await mkdir(projectDir, { recursive: true })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-storage'",
    "- name: '@deepseek-ai/dsh-storage-json'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- name: '@deepseek-ai/dsh-storage-domain'",
    '  config:',
    '    backend: json',
    ...withSettings
      ? [
        "- name: '@deepseek-ai/dsh-settings-file'",
        '  config:',
        `    path: ${JSON.stringify(join(root, 'settings.yaml'))}`,
        '    watch: false',
        "- name: '@deepseek-ai/dsh-system-prompt'",
        '  config:',
        '    includeHarnessIdentity: false',
        '    includeRuntimeContext: false',
      ]
      : [],
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    `    root: ${JSON.stringify(join(root, 'sessions'))}`,
    "- name: '@deepseek-ai/dsh-workspace'",
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@idealize/artefacts'",
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@idealize/artefacts', ArtefactStore],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return { ctx: context, projectDir, port: context.webServer.port }
}

/** GET one path with an overridable Host header and extra headers; returns status, content-type, headers, and raw body. */
function request(
  port: number,
  path: string,
  host = '127.0.0.1',
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; contentType: string | undefined; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    httpGet({ host: '127.0.0.1', port, path, headers: { host, ...extraHeaders } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk as Buffer))
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
      res.on('error', reject)
    }).on('error', reject)
  })
}

/** POST a JSON body with the mutating header unless `auth` is false. */
function post(
  port: number,
  path: string,
  body: string,
  auth = true,
): Promise<{ status: number; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json', ...auth ? { 'x-idealize-auth': '1' } : {} },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk as Buffer))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end(body)
  })
}

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000',
  'hex',
)

/** A ready-to-send create request over the booted composition. */
function createRequest(
  ctx: Context,
  projectDir: string,
  workspaceId: ArtefactCreateRequest['provenance']['workspaceId'],
  overrides: Partial<ArtefactCreateRequest> = {},
): ArtefactCreateRequest {
  const session = ctx.sessions.create(undefined, { meta: { cwd: projectDir } })
  return {
    session,
    mediaType: 'image/png',
    bytes: PNG_BYTES,
    settings: { prompt: 'a fish' },
    sourceTask: { turnSeq: 1, callId: CallId('call-1'), toolName: 'gallery_generate' },
    provenance: { provider: 'openrouter', model: 'test/image-model', workspaceId },
    ...overrides,
  }
}

describe('@idealize/artefacts composition', () => {
  it('creates an artefact: bytes on disk, durable record, artefact/created with the ignorable envelope', async () => {
    const { ctx, projectDir } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const request_ = createRequest(ctx, projectDir, workspace.id)
    const record = await ctx.artefacts.create(request_)

    expect(record.schemaVersion).toBe(1)
    expect(record.mediaType).toBe('image/png')
    expect(record.storage.kind).toBe('file')
    // The default folder, a day-first file name, and no disposition while kept.
    expect(record.storage.relPath).toMatch(/^Images\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.png$/)
    expect(record.disposition).toBeUndefined()
    expect(record.storage.bytes).toBe(PNG_BYTES.byteLength)
    expect(record.storage.sha256).toBe(createHash('sha256').update(PNG_BYTES).digest('hex'))
    expect(record.sourceTask.sessionId).toBe(request_.session.header.id)
    expect(record.provenance.workspaceId).toBe(workspace.id)

    const stored = await readFile(join(projectDir, record.storage.relPath))
    expect(stored.equals(PNG_BYTES)).toBe(true)

    const event = request_.session.events.at(-1)
    expect(event?.type).toBe('artefact/created')
    expect(event?.ignorable).toBe(true)
    expect((event?.data as { record: { id: string } }).record.id).toBe(record.id)

    expect(ctx.artefacts.get(record.id)?.storage.sha256).toBe(record.storage.sha256)
    expect(ctx.artefacts.list({ workspaceId: workspace.id, mediaType: 'image' })).toHaveLength(1)
    expect(ctx.artefacts.list({ mediaType: 'audio' })).toHaveLength(0)
    // The registry canonicalizes the workspace path (realpath), so resolve()
    // is asserted against the workspace's own path, not the raw temp dir.
    expect(ctx.artefacts.resolve(record.id)).toBe(join(workspace.path, record.storage.relPath))
  })

  it('serves the raw route: 200 with the record media type, 404 for unknown ids, 403 off loopback', async () => {
    const { ctx, projectDir, port } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const record = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))

    const ok = await request(port, `/idealize/artefacts/raw?id=${record.id}`)
    expect(ok.status).toBe(200)
    expect(ok.contentType).toBe('image/png')
    expect(ok.body.equals(PNG_BYTES)).toBe(true)

    const unknown = await request(port, `/idealize/artefacts/raw?id=${ArtefactId('no-such')}`)
    expect(unknown.status).toBe(404)

    const missingId = await request(port, '/idealize/artefacts/raw')
    expect(missingId.status).toBe(400)

    const offLoopback = await request(port, `/idealize/artefacts/raw?id=${record.id}`, 'evil.example')
    expect(offLoopback.status).toBe(403)
  })

  it('revalidates the raw route: an ETag with no-cache, 304 while the file is unchanged, 200 with new bytes once it changes', async () => {
    const { ctx, projectDir, port } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const record = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))
    const path = `/idealize/artefacts/raw?id=${record.id}`

    const first = await request(port, path)
    expect(first.status).toBe(200)
    expect(first.headers['cache-control']).toBe('no-cache')
    const etag = first.headers.etag
    expect(etag).toMatch(/^"[^"]+"$/)
    if (etag === undefined) throw new Error('no etag')

    const unchanged = await request(port, path, '127.0.0.1', { 'if-none-match': etag })
    expect(unchanged.status).toBe(304)
    expect(unchanged.body.length).toBe(0)
    expect(unchanged.headers.etag).toBe(etag)
    expect(unchanged.headers['cache-control']).toBe('no-cache')

    // A list with a weak-prefixed copy of the tag still matches.
    const listed = await request(port, path, '127.0.0.1', { 'if-none-match': `"other", W/${etag}` })
    expect(listed.status).toBe(304)
    const stale = await request(port, path, '127.0.0.1', { 'if-none-match': '"other"' })
    expect(stale.status).toBe(200)

    // Rewrite with a different size, so the ETag changes whatever the mtime granularity.
    const changed = Buffer.concat([PNG_BYTES, Buffer.from('changed')])
    await writeFile(ctx.artefacts.resolve(record.id), changed)
    const refetched = await request(port, path, '127.0.0.1', { 'if-none-match': etag })
    expect(refetched.status).toBe(200)
    expect(refetched.headers.etag).toMatch(/^"[^"]+"$/)
    expect(refetched.headers.etag).not.toBe(etag)
    expect(refetched.body.equals(changed)).toBe(true)
  })

  it('refuses a record whose stored path escapes the project', async () => {
    const { ctx, projectDir, port } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const record = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))

    // Swap the stored bytes for a symlink escaping the fence: realpath
    // resolves outside the project root, so the route must refuse.
    const outside = join(root!, 'secret.txt')
    await writeFile(outside, 'outside the fence')
    const stored = join(projectDir, record.storage.relPath)
    await rm(stored)
    await symlink(outside, stored)

    const escaped = await request(port, `/idealize/artefacts/raw?id=${record.id}`)
    expect(escaped.status).toBe(403)
  })

  it('appends artefact/failed with the cause and removes the partial file when the byte stream fails', async () => {
    const { ctx, projectDir } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield PNG_BYTES.subarray(0, 4)
      throw new Error('provider stream torn')
    }
    const request_ = createRequest(ctx, projectDir, workspace.id, { bytes: failing() })
    await expect(ctx.artefacts.create(request_)).rejects.toThrow('provider stream torn')

    const event = request_.session.events.at(-1)
    expect(event?.type).toBe('artefact/failed')
    expect(event?.ignorable).toBe(true)
    const data = event?.data as { error: string; mediaType: string }
    expect(data.error).toContain('provider stream torn')
    expect(ctx.artefacts.list()).toHaveLength(0)
  })

  it('rejects an unknown workspace before writing anything', async () => {
    const { ctx, projectDir } = await loadComposition()
    const request_ = createRequest(ctx, projectDir, 'not-a-workspace' as never)
    await expect(ctx.artefacts.create(request_)).rejects.toThrow("unknown workspace 'not-a-workspace'")
  })

  it('saves each kind under its own folder, and under the user\'s folders once the settings section names them', async () => {
    const { ctx, projectDir } = await loadComposition(true)
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const sound = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id, { mediaType: 'audio/wav' }))
    const clip = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id, { mediaType: 'video/mp4' }))
    const blob = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id, { mediaType: 'application/x-thing' }))
    expect(sound.storage.relPath.startsWith('Sounds/')).toBe(true)
    expect(clip.storage.relPath.startsWith('Video/')).toBe(true)
    expect(blob.storage.relPath).toMatch(/^Artefacts\/.*\.bin$/)

    await ctx.settings.update(settingsNamespace(ARTEFACT_SETTINGS_NAMESPACE), { images: 'Media/Pictures' })
    const picture = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))
    expect(picture.storage.relPath).toMatch(/^Media\/Pictures\/\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.png$/)
    expect((await readFile(join(projectDir, picture.storage.relPath))).equals(PNG_BYTES)).toBe(true)
    // Earlier records keep the path they were written with.
    expect(ctx.artefacts.get(sound.id)?.storage.relPath).toBe(sound.storage.relPath)

    // A folder that would leave the project is refused at the settings boundary.
    await expect(ctx.settings.update(settingsNamespace(ARTEFACT_SETTINGS_NAMESPACE), { images: '../elsewhere' }))
      .rejects.toThrow()
  })

  it('tells every agent where the project\'s files live, from the folder settings in force', async () => {
    const { ctx } = await loadComposition(true)
    const prompt = async (): Promise<string> => renderPrompt(await ctx.systemPrompt.assemble({}))
    expect(describeFolders({ images: 'Images', sounds: 'Sounds', video: 'Video', other: 'Artefacts', archive: 'Archive' }))
      .toBe('images in Images/, sounds in Sounds/, video in Video/, anything else in Artefacts/ (archived files under each folder\'s Archive/)')
    // The section is registered by an injected child plugin, a tick after the Loader settles.
    await vi.waitFor(async () => { expect(await prompt()).toContain(FOLDERS_SECTION.name === 'idealize:artefacts' ? 'saved under its root' : '') })
    const before = await prompt()
    expect(before).toContain('saved under its root: images in Images/, sounds in Sounds/, video in Video/, anything else in Artefacts/')
    expect(before).toContain('call artefacts_get with the id')
    expect(before).not.toContain('{{')
    expect(FOLDERS_SECTION.order).toBe(121)
    await ctx.settings.update(settingsNamespace(ARTEFACT_SETTINGS_NAMESPACE), { images: 'Media/Pictures' })
    expect(await prompt()).toContain('images in Media/Pictures/')
  })

  it('archives and keeps: the file moves, the record and its path follow, the producing chat logs the verdict', async () => {
    const { ctx, projectDir, port } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const request_ = createRequest(ctx, projectDir, workspace.id)
    const record = await ctx.artefacts.create(request_)
    const file = record.storage.relPath.split('/').at(-1)!

    const archived = await post(port, '/idealize/artefacts/disposition', JSON.stringify({ id: record.id, disposition: 'archived' }))
    expect(archived.status).toBe(200)
    const moved = (archived.json() as { record: ArtefactRecord }).record
    expect(moved.disposition).toBe('archived')
    expect(moved.storage.relPath).toBe(`Images/Archive/${file}`)
    expect((await readFile(join(projectDir, moved.storage.relPath))).equals(PNG_BYTES)).toBe(true)
    await expect(readFile(join(projectDir, record.storage.relPath))).rejects.toThrow()
    expect(ctx.artefacts.get(record.id)?.disposition).toBe('archived')
    const logged = request_.session.events.at(-1)
    expect(logged?.type).toBe('artefact/disposition')
    expect(logged?.ignorable).toBe(true)
    expect(logged?.data).toEqual({
      artefactId: record.id, disposition: 'archived', relPath: moved.storage.relPath, sourceTask: record.sourceTask,
    })

    // The archived bytes still serve (the fence is the project root).
    expect((await request(port, `/idealize/artefacts/raw?id=${record.id}`)).status).toBe(200)

    // Asking again moves nothing and logs nothing.
    const again = await ctx.artefacts.setDisposition(record.id, 'archived')
    expect(again).toEqual(moved)
    expect(request_.session.events.at(-1)).toBe(logged)

    const kept = await ctx.artefacts.setDisposition(record.id, 'kept')
    expect(kept.disposition).toBeUndefined()
    expect(kept.storage.relPath).toBe(record.storage.relPath)
    expect((await readFile(join(projectDir, kept.storage.relPath))).equals(PNG_BYTES)).toBe(true)
    expect(request_.session.events.at(-1)?.data).toMatchObject({ artefactId: record.id, disposition: 'kept', relPath: record.storage.relPath })
  })

  it('fences the disposition route: POST only, loopback, the auth header, a checked body, a known record', async () => {
    const { ctx, projectDir, port } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const record = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))
    const body = JSON.stringify({ id: record.id, disposition: 'archived' })
    expect((await request(port, '/idealize/artefacts/disposition')).status).toBe(405)
    expect((await post(port, '/idealize/artefacts/disposition', body, false)).status).toBe(403)
    expect((await post(port, '/idealize/artefacts/disposition', 'not json')).status).toBe(400)
    expect((await post(port, '/idealize/artefacts/disposition', '[]')).status).toBe(400)
    expect((await post(port, '/idealize/artefacts/disposition', JSON.stringify({ disposition: 'archived' }))).status).toBe(400)
    expect((await post(port, '/idealize/artefacts/disposition', JSON.stringify({ id: record.id, disposition: 'binned' }))).status).toBe(400)
    expect((await post(port, '/idealize/artefacts/disposition', JSON.stringify({ id: 'nope', disposition: 'archived' }))).status).toBe(404)
    expect(ctx.artefacts.get(record.id)?.disposition).toBeUndefined()
    await expect(ctx.artefacts.setDisposition(ArtefactId('nope'), 'kept')).rejects.toThrow("unknown artefact 'nope'")
  })

  it('artefacts_get resolves a record into model-visible facts', async () => {
    const { ctx, projectDir } = await loadComposition()
    const workspace = await ctx.workspaceRegistry.create(projectDir)
    const record = await ctx.artefacts.create(createRequest(ctx, projectDir, workspace.id))

    const tool = createArtefactsGetTool(ctx.artefacts)
    const value = await tool.execute({ id: String(record.id) }, {} as never) as
      { path: string; mediaType: string; sha256: string; settings: unknown }
    expect(value.mediaType).toBe('image/png')
    expect(value.path).toBe(join(workspace.path, record.storage.relPath))
    expect(value.sha256).toBe(record.storage.sha256)
    expect(value.settings).toEqual({ prompt: 'a fish' })

    await expect(Promise.resolve(tool.execute({ id: 'missing' }, {} as never)))
      .rejects.toThrow("unknown artefact 'missing'")
  })
})
