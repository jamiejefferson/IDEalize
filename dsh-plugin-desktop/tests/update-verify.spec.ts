import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdateDownloadError } from '../src/update-download.ts'
import {
  RELEASE_APP_FOLDER,
  RELEASE_CERTIFICATE_SHA1,
  RELEASE_REQUIREMENT,
  verifyMacUpdate,
  type VerifyCommand,
} from '../src/update-verify.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface Scenario {
  readonly attach?: number
  readonly codesign?: number
  readonly version?: string
  readonly extra?: string
  readonly noApp?: boolean
}

interface Harness {
  readonly run: VerifyCommand
  readonly makeMountPoint: () => Promise<string>
  readonly calls: { command: string; args: readonly string[] }[]
}

function harness(scenario: Scenario = {}): Harness {
  const calls: { command: string; args: readonly string[] }[] = []
  let mount = ''
  return {
    calls,
    makeMountPoint: async () => {
      mount = await mkdtemp(join(tmpdir(), 'idealize-verify-'))
      roots.push(mount)
      return mount
    },
    run: async (command, args) => {
      calls.push({ command, args })
      if (command.endsWith('hdiutil') && args[0] === 'attach') {
        if ((scenario.attach ?? 0) !== 0) return { status: scenario.attach ?? 1, stdout: '' }
        if (scenario.noApp !== true) await mkdir(join(mount, RELEASE_APP_FOLDER, 'Contents'), { recursive: true })
        await symlink('/Applications', join(mount, 'Applications'))
        await writeFile(join(mount, '.DS_Store'), '')
        if (scenario.extra !== undefined) await writeFile(join(mount, scenario.extra), '')
        return { status: 0, stdout: '' }
      }
      if (command.endsWith('codesign')) return { status: scenario.codesign ?? 0, stdout: '' }
      if (command.endsWith('plutil')) return { status: 0, stdout: `${scenario.version ?? '1.0.19'}\n` }
      return { status: 0, stdout: '' }
    },
  }
}

async function refusal(promise: Promise<unknown>): Promise<UpdateDownloadError> {
  try {
    await promise
  } catch (cause) {
    expect(cause).toBeInstanceOf(UpdateDownloadError)
    return cause as UpdateDownloadError
  }
  throw new Error('expected a refusal')
}

function verify(h: Harness, currentVersion = '1.0.18') {
  return verifyMacUpdate({ dmgPath: '/tmp/x.dmg', currentVersion, run: h.run, makeMountPoint: h.makeMountPoint })
}

describe('macOS update verification', () => {
  it('pins the release certificate by value, with the self-signed root form', () => {
    expect(RELEASE_CERTIFICATE_SHA1).toBe('39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3')
    expect(RELEASE_REQUIREMENT).toBe('identifier "ai.projject.idealize.v1" and certificate root = H"39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3"')
  })

  it('passes a release signed by the pinned certificate and detaches the image', async () => {
    const h = harness()
    await expect(verify(h)).resolves.toEqual({ version: '1.0.19' })
    expect(h.calls[0]?.args).toEqual(expect.arrayContaining(['attach', '/tmp/x.dmg', '-nobrowse', '-readonly']))
    const codesign = h.calls.find(call => call.command === '/usr/bin/codesign')
    expect(codesign?.args).toEqual(expect.arrayContaining([
      '--verify', '--deep', '--strict', `--test-requirement==${RELEASE_REQUIREMENT}`,
    ]))
    expect(h.calls.at(-1)?.args[0]).toBe('detach')
  })

  it('removes its private mount folder afterwards', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'idealize-verify-'))
    roots.push(empty)
    const h = harness({ attach: 1 })
    await refusal(verifyMacUpdate({ dmgPath: '/tmp/x.dmg', currentVersion: '1.0.18', run: h.run, makeMountPoint: async () => empty }))
    await expect(access(empty)).rejects.toThrow()
  })

  it('refuses an app the certificate did not sign, and still detaches', async () => {
    const h = harness({ codesign: 3 })
    expect((await refusal(verify(h))).code).toBe('untrusted-artifact')
    expect(h.calls.at(-1)?.args[0]).toBe('detach')
    expect(h.calls.some(call => call.command.endsWith('plutil'))).toBe(false)
  })

  it('refuses an image that will not mount, a missing app and a decoy beside the app', async () => {
    expect((await refusal(verify(harness({ attach: 1 })))).code).toBe('untrusted-artifact')
    expect((await refusal(verify(harness({ noApp: true })))).code).toBe('untrusted-artifact')
    const decoy = await refusal(verify(harness({ extra: 'Install me.command' })))
    expect(decoy.code).toBe('untrusted-artifact')
    expect(decoy.message).toContain('Install me.command')
  })

  it.each([['1.0.18'], ['1.0.17'], ['0.9.0']])('refuses version %s on a 1.0.18 app', async (version) => {
    expect((await refusal(verify(harness({ version })))).code).toBe('not-newer')
  })

  it('refuses a version it cannot read as a release', async () => {
    expect((await refusal(verify(harness({ version: '2.0.0-beta.1' })))).code).toBe('untrusted-artifact')
    expect((await refusal(verify(harness({ version: 'garbage' })))).code).toBe('untrusted-artifact')
  })

  it('fails closed when a tool cannot run', async () => {
    const h = harness()
    const failing: VerifyCommand = async (command, args, options) => {
      if (command.endsWith('codesign')) throw new Error('spawn failed')
      return h.run(command, args, options)
    }
    const failure = await refusal(verifyMacUpdate({
      dmgPath: '/tmp/x.dmg', currentVersion: '1.0.18', run: failing, makeMountPoint: h.makeMountPoint,
    }))
    expect(failure.code).toBe('untrusted-artifact')
    expect(h.calls.at(-1)?.args[0]).toBe('detach')
  })
})
