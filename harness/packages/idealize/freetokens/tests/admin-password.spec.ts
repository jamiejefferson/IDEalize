/**
 * The admin-password record: the embedded sidecar's account and the password
 * that unlocks it stay in one directory, so a credential store reset no
 * longer strands a database whose setup endpoint has already run.
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAdminPassword, writeAdminPassword } from '../src/admin-password.ts'

const made: string[] = []
const dir = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'freetokens-admin-'))
  made.push(path)
  return path
}
afterEach(() => { for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('the sidecar admin-password record', () => {
  it('reads back what it wrote, in the directory holding the account', () => {
    const dataDir = dir()
    writeAdminPassword(dataDir, 'a-generated-password')
    expect(readAdminPassword(dataDir)).toBe('a-generated-password')
    expect(JSON.parse(readFileSync(join(dataDir, 'host-admin.json'), 'utf8'))).toEqual({ adminPassword: 'a-generated-password' })
  })

  it('creates the data directory when provisioning runs before the sidecar has written one', () => {
    const dataDir = join(dir(), 'not-yet')
    writeAdminPassword(dataDir, 'p')
    expect(readAdminPassword(dataDir)).toBe('p')
  })

  it('is readable by the owner alone', () => {
    const dataDir = dir()
    writeAdminPassword(dataDir, 'p')
    expect(statSync(join(dataDir, 'host-admin.json')).mode & 0o077).toBe(0)
  })

  it('reports no record rather than throwing when the directory has none', () => {
    expect(readAdminPassword(dir())).toBeUndefined()
  })

  it('treats a truncated or empty record as no record, so provisioning decides', () => {
    const dataDir = dir()
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'host-admin.json'), '{"adminPass', 'utf8')
    expect(readAdminPassword(dataDir)).toBeUndefined()
    writeFileSync(join(dataDir, 'host-admin.json'), '{"adminPassword":""}', 'utf8')
    expect(readAdminPassword(dataDir)).toBeUndefined()
  })
})
