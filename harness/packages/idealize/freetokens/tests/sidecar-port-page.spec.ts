/**
 * The sidecar's own port answers for itself. The forked server mounts a static
 * directory unconditionally; IDEalize ships no dashboard, so the child is
 * pointed at a directory holding one page that names the port instead of
 * letting every request end in a bare 404.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawned: { env: Record<string, string | undefined> }[] = []
vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, _args: string[], options: { env: Record<string, string | undefined> }) => {
    spawned.push({ env: options.env })
    return { on: () => {}, kill: () => {}, unref: () => {} }
  },
}))

const { SidecarManager } = await import('../src/sidecar.ts')

const made: string[] = []
afterEach(() => {
  spawned.length = 0
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true })
})

function manager(): { dataDir: string; start: () => Promise<void> } {
  const dataDir = mkdtempSync(join(tmpdir(), 'freetokens-port-'))
  made.push(dataDir)
  const entry = join(dataDir, 'server.mjs')
  writeFileSync(entry, '', 'utf8')
  const instance = new SidecarManager({ entry, port: 3213, dataDir, log: () => {} })
  // start() waits on a health probe the fake child never answers; the spawn
  // this test reads has already happened by then.
  return { dataDir, start: () => Promise.race([instance.start(), new Promise<void>((resolve) => { setTimeout(resolve, 0) })]) }
}

describe('the sidecar port page', () => {
  it('points the child at a directory it wrote, holding a page that names the port', async () => {
    const { dataDir, start } = manager()
    await start()

    const clientDist = spawned[0]?.env.CLIENT_DIST
    expect(clientDist).toBe(join(dataDir, 'port-page'))
    expect(existsSync(join(clientDist!, 'index.html'))).toBe(true)
    const page = readFileSync(join(clientDist!, 'index.html'), 'utf8')
    expect(page).toContain('IDEalize free tokens')
    // It must not claim to be the engine dashboard, which is not shipped.
    expect(page).toMatch(/no web interface of\s+its own/u)
  })
})
