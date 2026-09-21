// The command-line agent probe behind the Brains pane's Installed / Not
// installed / Could not check badge.
import { describe, expect, it } from 'vitest'
import { cliInstalled } from '../src/index.ts'

describe('cliInstalled', () => {
  it('finds a command on PATH and misses one that is not there', async () => {
    expect(await cliInstalled('ls')).toBe(true)
    expect(await cliInstalled('no-such-cli-idealize')).toBe(false)
  })

  it('refuses a name that is not one plain word, on either platform', async () => {
    expect(await cliInstalled('ls; rm -rf /')).toBeNull()
    expect(await cliInstalled('claude & calc', 'win32')).toBeNull()
  })

  it('asks where.exe on Windows, and says it could not check when the probe itself cannot run', async () => {
    // This host has no where.exe, which is the probe failing rather than the CLI missing.
    expect(await cliInstalled('claude', 'win32')).toBeNull()
  })
})
