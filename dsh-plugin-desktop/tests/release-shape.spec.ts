import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FuseV1Options } from '@electron/fuses'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROOF_BUILD_MARKER, refusedDebugSwitch } from '../src/debug-switches.ts'
import { HARDENED_PLATFORMS, hardeningApplies } from '../src/platform-hardening.ts'
import { ENABLE_COOKIE_ENCRYPTION, hardenMacPackage, macFuses } from '../scripts/after-pack.ts'
import { releaseShapeProblems, type AppFacts } from '../scripts/verify-release-shape.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const RELEASE_FACTS: AppFacts = {
  proofMarker: false,
  displayReport: 'CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1',
  requirementReport: 'designated => identifier "ai.projject.idealize.v1" and certificate root = H"39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3"',
  entitlements: 'com.apple.security.cs.allow-jit com.apple.security.cs.allow-unsigned-executable-memory com.apple.security.cs.disable-library-validation com.apple.security.device.audio-input',
  transportSecurity: '{"NSAllowsArbitraryLoads":false,"NSAllowsLocalNetworking":true}',
  fuses: {
    [FuseV1Options.RunAsNode]: 49,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: 48,
    [FuseV1Options.EnableNodeCliInspectArguments]: 48,
  },
}

describe('release check', () => {
  it('passes the release shape', () => {
    expect(releaseShapeProblems(RELEASE_FACTS, { pinned: true })).toEqual([])
  })

  it('refuses a proof build', () => {
    expect(releaseShapeProblems({ ...RELEASE_FACTS, proofMarker: true }, { pinned: true }).join())
      .toContain('proof build')
  })

  it('refuses a build with no hardened runtime, as 1.0.18 shipped', () => {
    expect(releaseShapeProblems({ ...RELEASE_FACTS, displayReport: 'flags=0x0(none)' }, { pinned: true }).join())
      .toContain('hardened runtime')
  })

  it('refuses another certificate when pinned, and accepts it for a local build', () => {
    const local = { ...RELEASE_FACTS, requirementReport: 'designated => identifier "ai.projject.idealize.v1" and certificate root = H"a99e163248cc0f08e2c87ca449f717cc364ad63c"' }
    expect(releaseShapeProblems(local, { pinned: true }).join()).toContain('release certificate')
    expect(releaseShapeProblems(local, { pinned: false })).toEqual([])
  })

  it('refuses open fuses, a missing entitlement, an injection entitlement and open transport', () => {
    expect(releaseShapeProblems({ ...RELEASE_FACTS, fuses: { ...RELEASE_FACTS.fuses, [FuseV1Options.EnableNodeCliInspectArguments]: 49 } }, { pinned: true }).join())
      .toContain('EnableNodeCliInspectArguments')
    expect(releaseShapeProblems({ ...RELEASE_FACTS, fuses: { ...RELEASE_FACTS.fuses, [FuseV1Options.RunAsNode]: 48 } }, { pinned: true }).join())
      .toContain('RunAsNode')
    expect(releaseShapeProblems({ ...RELEASE_FACTS, entitlements: 'com.apple.security.cs.allow-jit' }, { pinned: true }).join())
      .toContain('audio-input')
    expect(releaseShapeProblems({ ...RELEASE_FACTS, entitlements: `${RELEASE_FACTS.entitlements} com.apple.security.cs.allow-dyld-environment-variables` }, { pinned: true }).join())
      .toContain('allow-dyld')
    expect(releaseShapeProblems({ ...RELEASE_FACTS, transportSecurity: '{"NSAllowsArbitraryLoads":true,"NSAllowsLocalNetworking":true}' }, { pinned: true }).join())
      .toContain('NSAllowsArbitraryLoads')
  })
})

describe('macOS packaging hook', () => {
  function context(platform = 'darwin', arch?: number) {
    const root = mkdtempSync(join(tmpdir(), 'idealize-after-pack-'))
    roots.push(root)
    mkdirSync(join(root, 'IDEalize V1.app', 'Contents', 'Resources'), { recursive: true })
    return {
      appOutDir: root,
      electronPlatformName: platform,
      ...arch === undefined ? {} : { arch },
      packager: { appInfo: { productFilename: 'IDEalize V1' } },
    }
  }

  it('turns arbitrary loads off in the plist, after Electron Builder has written it', async () => {
    const plutil = vi.fn()
    const packed = context()
    await hardenMacPackage(packed, { env: {}, flip: vi.fn(async () => undefined), plutil })
    const plist = join(packed.appOutDir, 'IDEalize V1.app', 'Contents', 'Info.plist')
    expect(plutil).toHaveBeenCalledWith(['-replace', 'NSAppTransportSecurity.NSAllowsArbitraryLoads', '-bool', 'false', plist])
    expect(plutil).toHaveBeenCalledWith(['-replace', 'NSAppTransportSecurity.NSAllowsLocalNetworking', '-bool', 'true', plist])
  })

  it('closes the two fuses on a release build and writes no marker', async () => {
    const flip = vi.fn(async () => undefined)
    const packed = context()
    await hardenMacPackage(packed, { env: {}, flip, plutil: vi.fn() })
    expect(flip).toHaveBeenCalledWith(join(packed.appOutDir, 'IDEalize V1.app'), {
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableCookieEncryption]: false,
    })
    expect(existsSync(join(packed.appOutDir, 'IDEalize V1.app', 'Contents', 'Resources', PROOF_BUILD_MARKER))).toBe(false)
  })

  it('a proof build leaves them open and writes the marker', async () => {
    const flip = vi.fn(async () => undefined)
    const packed = context()
    await hardenMacPackage(packed, { env: { IDEALIZE_PROOF_BUILD: '1' }, flip, plutil: vi.fn() })
    expect(flip).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: true,
      [FuseV1Options.EnableNodeCliInspectArguments]: true,
    }))
    expect(existsSync(join(packed.appOutDir, 'IDEalize V1.app', 'Contents', 'Resources', PROOF_BUILD_MARKER))).toBe(true)
  })

  it('leaves Windows and the merged universal pass alone', async () => {
    const flip = vi.fn(async () => undefined)
    const plutil = vi.fn()
    await hardenMacPackage(context('win32'), { env: {}, flip, plutil })
    await hardenMacPackage(context('darwin', 4), { env: {}, flip, plutil })
    expect(flip).not.toHaveBeenCalled()
    expect(plutil).not.toHaveBeenCalled()
  })

  it('keeps cookie encryption off in this release, on one constant', () => {
    expect(ENABLE_COOKIE_ENCRYPTION).toBe(false)
    expect(macFuses(false)[FuseV1Options.EnableCookieEncryption]).toBe(false)
    expect(macFuses(true)[FuseV1Options.EnableCookieEncryption]).toBe(false)
  })

  it('the manifest keeps its own fuses to the setting Windows needs', () => {
    const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'package.json'), 'utf8')) as { build: { electronFuses: unknown } }
    expect(manifest.build.electronFuses).toEqual({ runAsNode: true })
  })
})

describe('debug switches on a packaged build', () => {
  const launch = (argv: readonly string[], overrides = {}) => ({
    isPackaged: true,
    proofBuild: false,
    argv,
    hasSwitch: () => false,
    ...overrides,
  })

  it.each([
    ['--remote-debugging-port=9334', 'remote-debugging-port'],
    ['--remote-debugging-port', 'remote-debugging-port'],
    ['--remote-debugging-pipe', 'remote-debugging-pipe'],
    ['--inspect', 'inspect'],
    ['--inspect=9339', 'inspect'],
    ['--inspect-brk=1', 'inspect-brk'],
    ['-remote-debugging-port=1', 'remote-debugging-port'],
  ])('refuses %s', (argument, name) => {
    expect(refusedDebugSwitch(launch(['/app', argument]))).toBe(name)
  })

  it('catches a switch only Chromium could read', () => {
    expect(refusedDebugSwitch(launch(['/app'], { hasSwitch: (name: string) => name === 'remote-debugging-pipe' })))
      .toBe('remote-debugging-pipe')
  })

  it('allows an ordinary launch, a dev run and a proof build', () => {
    expect(refusedDebugSwitch(launch(['/app', '--user-data-dir=/x', '--inspector-theme']))).toBeUndefined()
    expect(refusedDebugSwitch(launch(['/app', '--inspect'], { isPackaged: false }))).toBeUndefined()
    expect(refusedDebugSwitch(launch(['/app', '--inspect'], { proofBuild: true }))).toBeUndefined()
  })

  it('applies on macOS only until JJ decides on Windows', () => {
    expect(HARDENED_PLATFORMS).toEqual(['darwin'])
    expect(hardeningApplies('darwin')).toBe(true)
    expect(hardeningApplies('win32')).toBe(false)
  })
})
