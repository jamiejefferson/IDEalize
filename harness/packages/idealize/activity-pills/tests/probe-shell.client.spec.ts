import { describe, expect, it } from 'vitest'
import { probeFlags, probeShell } from '../src/index.ts'

describe.skipIf(process.platform === 'win32')('the CLI probe shell', () => {
  it('takes the login shell SHELL names when it exists', () => {
    expect(probeShell('/opt/fish', path => path === '/opt/fish')).toBe('/opt/fish')
  })

  it('falls back through zsh, bash and sh when SHELL is unset or names nothing', () => {
    expect(probeShell(undefined, path => path === '/bin/bash')).toBe('/bin/bash')
    expect(probeShell('', path => path === '/bin/sh')).toBe('/bin/sh')
    expect(probeShell('/gone', path => path === '/bin/zsh')).toBe('/bin/zsh')
  })

  it('reports no shell on a bare image', () => {
    expect(probeShell('/gone', () => false)).toBeNull()
  })

  it('runs zsh and bash interactively so their rc files reach PATH, and sh as a plain login shell', () => {
    expect(probeFlags('/bin/zsh')).toBe('-lic')
    expect(probeFlags('/bin/bash')).toBe('-lic')
    expect(probeFlags('/bin/sh')).toBe('-lc')
  })
})
