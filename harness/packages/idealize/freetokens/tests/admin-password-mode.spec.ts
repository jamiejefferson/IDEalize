/**
 * The admin file's mode comes from the create call. chmod is stubbed here, so a
 * write followed by a chmod, which leaves the password readable for a moment,
 * fails this test.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(),
  chmodSync: () => {},
}))

const { writeAdminPassword } = await import('../src/admin-password.ts')

const made: string[] = []
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe.skipIf(process.platform === 'win32')('the admin file as it is created', () => {
  it('is readable by the owner alone from the first moment', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'freetokens-admin-mode-'))
    made.push(dataDir)
    writeAdminPassword(dataDir, 'p')
    expect(statSync(join(dataDir, 'host-admin.json')).mode & 0o777).toBe(0o600)
  })
})
