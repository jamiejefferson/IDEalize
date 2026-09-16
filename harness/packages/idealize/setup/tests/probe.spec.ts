// The SET-04 promise: every refused folder comes back with a plain sentence
// naming the path and what to do, and only a folder passing stat + read +
// write probes counts as ok.
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeFolder } from '../src/probe.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) {
    await chmod(root, 0o755).catch(() => undefined)
    for (const child of ['locked', 'sealed']) {
      await chmod(join(root, child), 0o755).catch(() => undefined)
    }
    await rm(root, { recursive: true, force: true })
  }
  root = undefined
})

const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe('probeFolder', () => {
  it('refuses a relative path with a full-path explanation', async () => {
    const probe = await probeFolder('Projects/here')
    expect(probe.state).toBe('missing')
    expect(probe.reason).toContain('not a full folder path')
    expect(probe.reason).toContain('Projects/here')
  })

  it('explains a missing folder plainly, naming the path', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const gone = join(root, 'nope')
    const probe = await probeFolder(gone)
    expect(probe.state).toBe('missing')
    expect(probe.reason).toContain(gone)
    expect(probe.reason).toContain('There is no folder at')
  })

  it('refuses a file with a pick-a-folder explanation', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const file = join(root, 'notes.txt')
    await writeFile(file, 'x')
    const probe = await probeFolder(file)
    expect(probe.state).toBe('not-a-directory')
    expect(probe.reason).toContain('is a file, not a folder')
  })

  it.skipIf(runningAsRoot)('reports a read-only folder as unwritable with a permissions explanation', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const locked = join(root, 'locked')
    await mkdir(locked)
    await chmod(locked, 0o555)
    const probe = await probeFolder(locked)
    expect(probe.state).toBe('unwritable')
    expect(probe.reason).toContain('cannot save files inside')
    expect(probe.reason).toContain(locked)
  })

  it.skipIf(runningAsRoot)('reports an unlistable folder as unreadable', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const sealed = join(root, 'sealed')
    await mkdir(sealed)
    await chmod(sealed, 0o311)
    const probe = await probeFolder(sealed)
    expect(probe.state).toBe('unreadable')
    expect(probe.reason).toContain('cannot read inside')
  })

  it('passes a usable folder with no reason and leaves no probe file behind', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const probe = await probeFolder(root)
    expect(probe).toEqual({ state: 'ok' })
    const { readdir } = await import('node:fs/promises')
    expect((await readdir(root)).filter(name => name.startsWith('.idealize-probe-'))).toEqual([])
  })

  it.skipIf(runningAsRoot)('reports a folder it may not even look at as unreadable', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-setup-probe-'))
    const sealed = join(root, 'sealed')
    const inside = join(sealed, 'projects')
    await mkdir(inside, { recursive: true })
    // No execute bit on the parent: the stat itself is refused, before the
    // folder can be listed.
    await chmod(sealed, 0o600)
    const probe = await probeFolder(inside)
    await chmod(sealed, 0o700)

    expect(probe.state).toBe('unreadable')
    expect(probe.reason).toContain('is not allowed to look at')
  })
})
