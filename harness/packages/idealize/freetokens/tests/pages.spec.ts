/**
 * The two served pages and the spend meter's project attribution: what the
 * status page states about the engine, and the label a request is billed to.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { IdealizeAttribution, PROJECT_HEADER } from '../src/attribution.ts'
import { spendPage } from '../src/spend-page.ts'
import { statusPage } from '../src/status-page.ts'

const scratches: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  for (const scratch of scratches.splice(0)) rmSync(scratch, { recursive: true, force: true })
})

const view = {
  baseURL: 'http://127.0.0.1:8000',
  detected: false,
  keyStored: false,
  routeRegistered: false,
}

describe('the status page', () => {
  it('names the built-in engine when one is embedded', () => {
    const html = statusPage({ ...view, embedded: 'v2.1', detected: true, routeRegistered: true, modelCount: 42 })
    expect(html).toContain('Built-in engine v2.1')
    expect(html).toContain('with 42 models')
    // The lamp follows the registration when an engine is embedded, so an
    // embedded engine with no provider yet reads as off.
    expect(statusPage({ ...view, embedded: 'v2.1' })).toContain('class="dot off"')
    expect(html).toContain('class="dot on"')
  })

  it('names the server it found, and the one it did not', () => {
    expect(statusPage({ ...view, detected: true })).toContain('FreeLLMAPI answering at http://127.0.0.1:8000')
    const missing = statusPage(view)
    expect(missing).toContain('Nothing answering at http://127.0.0.1:8000')
    expect(missing).toContain('Provider not registered yet')
  })

  it('says a provider is registered even when it counts no models, and offers the platforms', () => {
    const html = statusPage({ ...view, routeRegistered: true })
    expect(html).toContain('Provider registered —')
    expect(html).toContain('<option value="openrouter">openrouter</option>')
  })
})

describe('the spend page', () => {
  it('is a whole document', () => {
    expect(spendPage()).toMatch(/^<!doctype html>/)
    expect(spendPage()).toContain('</html>')
  })
})

describe('project attribution', () => {
  /** One attribution service over a fake session store. */
  async function attribution(sessions?: Record<string, string | undefined>) {
    const ctx = new Context()
    contexts.push(ctx)
    if (sessions !== undefined) {
      ctx.provide('sessions', {
        get: (id: string) => (id in sessions ? { header: { cwd: sessions[id] } } : undefined),
      } as never)
    }
    await ctx.plugin(IdealizeAttribution).await()
    return ctx.idealizeAttribution
  }

  it('bills a session in a repository to the repository', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'idealize-attr-repo-'))
    scratches.push(repo)
    execFileSync('git', ['-C', repo, 'init', '-q'])
    const inner = join(repo, 'packages')
    execFileSync('mkdir', [inner])

    const meter = await attribution({ 's-1': inner })
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
    // The second request for the same cwd reads the label it already resolved.
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(repo) })
  })

  it('bills a session outside a repository to its own directory', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'idealize-attr-plain-'))
    scratches.push(plain)
    const meter = await attribution({ 's-1': plain })
    expect(meter.headersFor('s-1')).toEqual({ [PROJECT_HEADER]: basename(plain) })
  })

  it('bills nothing without a session, a known session, a cwd, or a store', async () => {
    const meter = await attribution({ 's-1': undefined, 's-2': '' })
    expect(meter.headersFor(undefined)).toBeUndefined()
    expect(meter.headersFor('s-unknown')).toBeUndefined()
    expect(meter.headersFor('s-1')).toBeUndefined()
    expect(meter.headersFor('s-2')).toBeUndefined()

    const storeless = await attribution()
    expect(storeless.headersFor('s-1')).toBeUndefined()

    // A cwd with no directory name to take resolves to no label at all.
    const rootless = await attribution({ 's-3': '/' })
    expect(rootless.headersFor('s-3')).toBeUndefined()
  })
})
