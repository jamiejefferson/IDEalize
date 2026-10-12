/**
 * Project look: a logo and an accent colour per project, shown on the
 * project's row in the sidebar (feedback b08b34bf, 8 Oct 2026: "custom icons
 * for the project folders ... to quickly see at a glance the logo of a
 * project in the side bar. Could even choose an accent colour for each").
 *
 * The look lives beside the workspace registry, in its own file under the
 * app's data folder, keyed by workspace id. The registry's record and its wire
 * view stay as upstream shipped them; the sidebar fetches this route by its
 * literal path, as it does the space icons.
 *
 * - `GET  /idealize/project-look` lists the look of every opened project.
 * - `GET  /idealize/project-look/icon/<id>` serves a project's logo: the image
 *   the person chose (a copy kept in app data, so moving the original breaks
 *   nothing), or else the first obvious logo file in the project's folder.
 * - `POST /idealize/project-look/<id>` sets the accent and the logo mode.
 * - `PUT  /idealize/project-look/<id>/image` stores a chosen image.
 *
 * Every request passes the app's launch gate first; the mutating ones also
 * carry the IDEalize mutation header, as the other IDEalize routes do.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, sep } from 'node:path'

/** The route prefix every project-look request sits under. */
export const PROJECT_LOOK_PATH = '/idealize/project-look'

/** The largest logo the route reads or stores, in bytes. */
export const PROJECT_LOGO_MAX_BYTES = 512 * 1024

/** How long one folder scan for an automatic logo is trusted, ms. */
const AUTO_SCAN_TTL = 60_000

/**
 * The files an automatic logo is looked for in, relative to the project's
 * folder, in the order they are tried: a favicon first, since a web project's
 * favicon is the mark people already know it by, then logos and icons, then
 * the same names in the folders web frameworks keep them in.
 */
export const AUTO_LOGO_CANDIDATES: readonly string[] = [
  'favicon.svg', 'favicon.png', 'favicon.ico',
  'logo.svg', 'logo.png', 'icon.svg', 'icon.png',
  'public/favicon.svg', 'public/favicon.png', 'public/favicon.ico',
  'public/logo.svg', 'public/logo.png', 'public/icon.svg', 'public/icon.png',
  'app/icon.svg', 'app/icon.png', 'app/favicon.ico',
  'src/app/icon.svg', 'src/app/icon.png', 'src/app/favicon.ico',
  'static/favicon.svg', 'static/favicon.png', 'static/favicon.ico',
  'assets/logo.svg', 'assets/logo.png', 'assets/icon.png',
  'images/logo.svg', 'images/logo.png',
]

/** How a project's logo is chosen. */
export type ProjectLogoMode = 'auto' | 'custom' | 'none'

/** One project's stored look. */
export interface ProjectLookRecord {
  /** `#rrggbb`, or absent for no accent. */
  accent?: string
  /** Absent means automatic. */
  logo?: ProjectLogoMode
  /** The stored image's file name under the images folder, while `logo` is custom. */
  image?: string
}

/** One project's look as the sidebar receives it. */
export interface ProjectLookView {
  accent: string | null
  logo: ProjectLogoMode
  /** The logo's URL with a version query, or null when the row keeps its folder. */
  iconUrl: string | null
}

/** The image types a logo may be, by the extension it is stored and served under. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
}

/**
 * The image type of some bytes, from their opening signature; SVG is
 * recognised by an `<svg` element near the top. Anything else is refused.
 * @param body - the file's bytes.
 * @returns the extension to store it under, or undefined.
 */
export function sniffImage(body: Buffer): string | undefined {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg'
  if (body.length >= 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (body.length >= 6 && body.toString('latin1', 0, 4) === 'GIF8') return 'gif'
  if (body.length >= 4 && body[0] === 0 && body[1] === 0 && body[2] === 1 && body[3] === 0) return 'ico'
  const head = body.toString('utf8', 0, Math.min(body.length, 2048)).trimStart()
  if ((head.startsWith('<') || head.startsWith('﻿<')) && /<svg[\s>]/i.test(head)) return 'svg'
  return undefined
}

/**
 * Whether a value is an accent the store accepts.
 * @param value - the candidate.
 * @returns true for a `#rrggbb` colour.
 */
export function isAccent(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

/** The registry facts the route needs: each opened project's id and folder. */
export interface ProjectDirectory {
  list(): readonly { id: string; path: string }[]
}

/**
 * The project-look store and its routes' logic, over a data folder. Kept
 * free of the host context so the tests drive it over a temporary folder.
 */
export class ProjectLooks {
  private records: Record<string, ProjectLookRecord> | undefined
  private writing: Promise<void> = Promise.resolve()
  private readonly autoCache = new Map<string, { file: string | undefined; at: number }>()

  /**
   * @param dataDir - the folder the store file and stored images live in.
   * @param projects - the opened projects.
   * @param now - the clock, for the automatic-logo cache.
   */
  constructor(
    private readonly dataDir: string,
    private readonly projects: ProjectDirectory,
    private readonly now: () => number = Date.now,
  ) {}

  private get file(): string { return join(this.dataDir, 'project-look.json') }
  private get imageDir(): string { return join(this.dataDir, 'project-look') }

  /** The stored records; a missing or damaged file reads as no looks. */
  async load(): Promise<Record<string, ProjectLookRecord>> {
    if (this.records !== undefined) return this.records
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      parsed = undefined
    }
    const projects = (parsed as { projects?: unknown } | undefined)?.projects
    const records: Record<string, ProjectLookRecord> = {}
    if (projects !== null && typeof projects === 'object') {
      for (const [id, raw] of Object.entries(projects as Record<string, unknown>)) {
        if (raw === null || typeof raw !== 'object') continue
        const value = raw as Record<string, unknown>
        const record: ProjectLookRecord = {}
        if (isAccent(value.accent)) record.accent = value.accent.toLowerCase()
        if (value.logo === 'none' || value.logo === 'auto') record.logo = value.logo
        if (value.logo === 'custom' && typeof value.image === 'string' && /^[\w.-]+$/.test(value.image)) {
          record.logo = 'custom'
          record.image = value.image
        }
        records[id] = record
      }
    }
    this.records = records
    return records
  }

  private async save(): Promise<void> {
    const records = await this.load()
    const body = JSON.stringify({ version: 1, projects: records }, null, 2)
    this.writing = this.writing.then(async () => {
      await mkdir(this.dataDir, { recursive: true })
      const temp = `${this.file}.${process.pid}.tmp`
      await writeFile(temp, body)
      await rename(temp, this.file)
    })
    await this.writing
  }

  /**
   * The automatic logo in a project's folder: the first candidate that is a
   * small regular file whose real path stays inside the folder.
   * @param folder - the project's folder.
   * @returns the logo's absolute path, or undefined.
   */
  async autoLogo(folder: string): Promise<string | undefined> {
    const cached = this.autoCache.get(folder)
    if (cached !== undefined && this.now() - cached.at < AUTO_SCAN_TTL) return cached.file
    let found: string | undefined
    let root: string
    try {
      root = await realpath(folder)
    } catch {
      root = folder
    }
    for (const candidate of AUTO_LOGO_CANDIDATES) {
      try {
        const real = await realpath(join(folder, candidate))
        if (!real.startsWith(root + sep)) continue
        const info = await stat(real)
        if (!info.isFile() || info.size === 0 || info.size > PROJECT_LOGO_MAX_BYTES) continue
        found = real
        break
      } catch {
        continue
      }
    }
    this.autoCache.set(folder, { file: found, at: this.now() })
    return found
  }

  /**
   * The logo file a project shows, if any.
   * @param id - the workspace id.
   * @returns the file's path, or undefined for the folder glyph.
   */
  async logoFile(id: string): Promise<string | undefined> {
    const project = this.projects.list().find(p => p.id === id)
    if (project === undefined) return undefined
    const record = (await this.load())[id] ?? {}
    if (record.logo === 'none') return undefined
    if (record.logo === 'custom' && record.image !== undefined) return join(this.imageDir, record.image)
    return this.autoLogo(project.path)
  }

  /** Every opened project's look, for the sidebar. */
  async list(): Promise<Record<string, ProjectLookView>> {
    const records = await this.load()
    const items: Record<string, ProjectLookView> = {}
    for (const project of this.projects.list()) {
      const record = records[project.id] ?? {}
      const file = await this.logoFile(project.id)
      let iconUrl: string | null = null
      if (file !== undefined) {
        try {
          const info = await stat(file)
          iconUrl = `${PROJECT_LOOK_PATH}/icon/${encodeURIComponent(project.id)}?v=${Math.round(info.mtimeMs).toString(36)}-${info.size.toString(36)}`
        } catch {
          iconUrl = null
        }
      }
      items[project.id] = { accent: record.accent ?? null, logo: record.logo ?? 'auto', iconUrl }
    }
    return items
  }

  /**
   * Change a project's accent or logo mode.
   * @param id - the workspace id.
   * @param change - the fields to change; `accent: null` clears it.
   * @returns false when no opened project has that id.
   */
  async update(id: string, change: { accent?: string | null; logo?: 'auto' | 'none' }): Promise<boolean> {
    if (!this.projects.list().some(p => p.id === id)) return false
    const records = await this.load()
    const record = { ...records[id] }
    if (change.accent === null) delete record.accent
    else if (change.accent !== undefined) record.accent = change.accent.toLowerCase()
    if (change.logo !== undefined) {
      if (record.image !== undefined) await rm(join(this.imageDir, record.image), { force: true })
      delete record.image
      if (change.logo === 'auto') delete record.logo
      else record.logo = change.logo
    }
    records[id] = record
    await this.save()
    return true
  }

  /**
   * Store a chosen image as a project's logo.
   * @param id - the workspace id.
   * @param body - the image's bytes.
   * @returns 'ok', or why it was refused.
   */
  async storeImage(id: string, body: Buffer): Promise<'ok' | 'no-project' | 'too-large' | 'not-an-image'> {
    if (!this.projects.list().some(p => p.id === id)) return 'no-project'
    if (body.length > PROJECT_LOGO_MAX_BYTES) return 'too-large'
    const ext = sniffImage(body)
    if (ext === undefined) return 'not-an-image'
    const records = await this.load()
    const record = { ...records[id] }
    const name = `${createHash('sha1').update(id).digest('hex').slice(0, 16)}-${createHash('sha1').update(body).digest('hex').slice(0, 8)}.${ext}`
    await mkdir(this.imageDir, { recursive: true })
    await writeFile(join(this.imageDir, name), body)
    if (record.image !== undefined && record.image !== name) await rm(join(this.imageDir, record.image), { force: true })
    record.logo = 'custom'
    record.image = name
    records[id] = record
    await this.save()
    return 'ok'
  }
}

/**
 * Read a request body up to a limit. Past the limit the rest is still read
 * and dropped, so the client finishes sending and receives the refusal.
 */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size <= limit) chunks.push(chunk as Buffer)
  }
  return size > limit ? undefined : Buffer.concat(chunks)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body))
}

/**
 * Handle one request under {@link PROJECT_LOOK_PATH}.
 * @param looks - the store.
 * @param req - the request.
 * @param res - the response.
 * @param refuse - the loopback fence and mutation-header check the other IDEalize routes share.
 */
export async function handleProjectLook(
  looks: ProjectLooks,
  req: IncomingMessage,
  res: ServerResponse,
  refuse: (req: IncomingMessage, res: ServerResponse, mutating?: boolean) => boolean,
): Promise<void> {
  /* v8 ignore next -- a served request always carries a url; the guard only types the read. */
  const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  const rest = pathname.slice(PROJECT_LOOK_PATH.length).split('/').filter(part => part !== '').map(decodeURIComponent)

  if (rest.length === 0) {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('GET only')
      return
    }
    if (refuse(req, res)) return
    sendJson(res, 200, { items: await looks.list() })
    return
  }

  if (rest.length === 2 && rest[0] === 'icon') {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET' }).end('GET only')
      return
    }
    if (refuse(req, res)) return
    const file = await looks.logoFile(rest[1] as string)
    let body: Buffer | undefined
    try {
      if (file !== undefined && (await stat(file)).size <= PROJECT_LOGO_MAX_BYTES) body = await readFile(file)
    } catch {
      body = undefined
    }
    const ext = body === undefined ? undefined : sniffImage(body)
    if (body === undefined || ext === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('no logo')
      return
    }
    res.writeHead(200, {
      'content-type': IMAGE_TYPES[ext] as string,
      'content-length': body.length,
      'cache-control': 'no-cache',
      // A project's SVG is someone else's file: it may show as a picture and
      // must never run as a page on the app's origin.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'x-content-type-options': 'nosniff',
    }).end(body)
    return
  }

  const id = rest[0] as string
  if (rest.length === 1) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }).end('POST only')
      return
    }
    if (refuse(req, res, true)) return
    const raw = await readBody(req, 4096)
    let body: unknown
    try {
      body = raw === undefined ? undefined : JSON.parse(raw.toString('utf8'))
    } catch {
      body = undefined
    }
    if (body === null || typeof body !== 'object') {
      sendJson(res, 400, { error: 'body is not a JSON object' })
      return
    }
    const { accent, logo } = body as { accent?: unknown; logo?: unknown }
    if (accent !== undefined && accent !== null && !isAccent(accent)) {
      sendJson(res, 400, { error: 'accent must be #rrggbb or null' })
      return
    }
    if (logo !== undefined && logo !== 'auto' && logo !== 'none') {
      sendJson(res, 400, { error: 'logo must be "auto" or "none"' })
      return
    }
    const change: { accent?: string | null; logo?: 'auto' | 'none' } = {}
    if (accent !== undefined) change.accent = accent
    if (logo !== undefined) change.logo = logo
    if (!await looks.update(id, change)) {
      sendJson(res, 404, { error: 'no such project' })
      return
    }
    sendJson(res, 200, { ok: true })
    return
  }

  if (rest.length === 2 && rest[1] === 'image') {
    if (req.method !== 'PUT') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'PUT' }).end('PUT only')
      return
    }
    if (refuse(req, res, true)) return
    const body = await readBody(req, PROJECT_LOGO_MAX_BYTES)
    const outcome = body === undefined ? 'too-large' : await looks.storeImage(id, body)
    if (outcome === 'ok') sendJson(res, 200, { ok: true })
    else if (outcome === 'no-project') sendJson(res, 404, { error: 'no such project' })
    else if (outcome === 'too-large') sendJson(res, 413, { error: 'image is larger than 512 KB' })
    else sendJson(res, 415, { error: 'not a PNG, JPEG, WebP, GIF, ICO or SVG image' })
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
}
