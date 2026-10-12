import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runsWhenOpened } from '../src/runnable-path.ts'

describe('files host.openPath refuses because opening runs them', () => {
  it('refuses script, app and installer types in any case', async () => {
    for (const path of ['/tmp/x.command', '/tmp/X.APP', '/tmp/a.pkg', '/tmp/run.ps1', '/tmp/setup.exe']) {
      expect(await runsWhenOpened(path), path).toBe(true)
    }
  })
  it('refuses an extension-less executable and allows documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runnable-'))
    try {
      const tool = join(dir, 'tool')
      await writeFile(tool, '#!/bin/sh\n')
      await chmod(tool, 0o755)
      const doc = join(dir, 'plan.md')
      await writeFile(doc, '# plan\n')
      expect(await runsWhenOpened(tool)).toBe(process.platform !== 'win32')
      expect(await runsWhenOpened(doc)).toBe(false)
      expect(await runsWhenOpened(join(dir, 'missing.pdf'))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
