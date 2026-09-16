/**
 * The service route: source resolution over the fork markers, the GET report,
 * and the POST edit (auth fence, validation, persistence, fresh report).
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { handleServiceRoute, isServiceSource, resolveServiceSource } from '../src/service.ts'
import type { ServiceRouteDeps } from '../src/service.ts'

/** A directory carrying the fork markers the probe checks for. */
function checkout(): string {
  const dir = mkdtempSync(join(tmpdir(), 'idealize-hatch-src-'))
  writeFileSync(join(dir, 'FORK.md'), '# fork', 'utf8')
  writeFileSync(join(dir, 'package.json'), '{}', 'utf8')
  return dir
}

class FakeRequest extends EventEmitter {
  headers: Record<string, string>
  constructor(public method: string, headers: Record<string, string>, private readonly body = '') {
    super()
    this.headers = headers
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    if (this.body !== '') yield Buffer.from(this.body)
  }
}

class FakeResponse {
  status = 0
  chunks: string[] = []
  writeHead(status: number) {
    this.status = status
    return this
  }
  end(chunk?: string) {
    if (chunk !== undefined) this.chunks.push(chunk)
  }
  json(): unknown { return JSON.parse(this.chunks.join('')) }
}

/** Drive the handler with an in-memory persistence layer. */
function harness(options: { source?: string; settings?: boolean } = {}) {
  let stored = options.source
  const written: string[] = []
  const deps: ServiceRouteDeps = {
    currentSource: () => stored,
    writeSource: () => options.settings === false
      ? undefined
      : async (path) => {
        written.push(path)
        stored = path
      },
    resolveWorkspace: vi.fn(async path => path === stored ? { id: 'ws-1' } : undefined),
  }
  const call = async (method: string, body?: unknown, auth = true) => {
    const req = new FakeRequest(
      method,
      auth ? { 'x-idealize-auth': '1' } : {},
      body === undefined ? '' : JSON.stringify(body),
    )
    const res = new FakeResponse()
    await handleServiceRoute(deps, req as unknown as IncomingMessage, res as unknown as ServerResponse)
    return res
  }
  return { call, written }
}

describe('source resolution', () => {
  it('accepts only directories carrying both fork markers', () => {
    const dir = checkout()
    expect(isServiceSource(dir)).toBe(true)
    expect(isServiceSource(join(dir, 'missing'))).toBe(false)
  })

  it('falls back to the conventional dev location when unconfigured', () => {
    expect(resolveServiceSource(undefined).path).toBe(join(homedir(), 'dev', 'idealize'))
    const dir = checkout()
    expect(resolveServiceSource(dir)).toEqual({ path: dir, valid: true })
  })
})

describe('the service route', () => {
  it('reports the configured source with its open workspace', async () => {
    const dir = checkout()
    const { call } = harness({ source: dir })
    const res = await call('GET')
    expect(res.status).toBe(200)
    expect(res.json()).toEqual({ path: dir, valid: true, configured: true, workspaceId: 'ws-1' })
  })

  it('reports an invalid source without asking the workspace registry', async () => {
    const dir = join(checkout(), 'missing')
    const { call } = harness({ source: dir })
    const res = await call('GET')
    expect(res.json()).toEqual({ path: dir, valid: false, configured: true, workspaceId: null })
  })

  it('refuses an edit without the auth header', async () => {
    const { call, written } = harness()
    const res = await call('POST', { path: checkout() }, false)
    expect(res.status).toBe(403)
    expect(written).toEqual([])
  })

  it('refuses an absent or blank path', async () => {
    const { call, written } = harness()
    expect((await call('POST', {})).status).toBe(400)
    expect((await call('POST', { path: '   ' })).status).toBe(400)
    expect(written).toEqual([])
  })

  it('refuses a directory without the fork markers, naming what is missing', async () => {
    const { call, written } = harness()
    const res = await call('POST', { path: join(checkout(), 'missing') })
    expect(res.status).toBe(422)
    expect((res.json() as { error: string }).error).toContain('FORK.md + package.json')
    expect(written).toEqual([])
  })

  it('refuses the edit loudly while no settings provider is mounted', async () => {
    const { call, written } = harness({ settings: false })
    const res = await call('POST', { path: checkout() })
    expect(res.status).toBe(503)
    expect(written).toEqual([])
  })

  it('persists a valid edit and answers with the fresh report', async () => {
    const before = checkout()
    const after = checkout()
    const { call, written } = harness({ source: before })
    const res = await call('POST', { path: ` ${after} ` })
    expect(res.status).toBe(200)
    expect(written).toEqual([after])
    expect(res.json()).toEqual({ path: after, valid: true, configured: true, workspaceId: 'ws-1' })
  })
})
