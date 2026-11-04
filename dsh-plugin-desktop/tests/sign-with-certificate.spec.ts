import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertCertificateRequirement,
  assertHardened,
  certificateIdentity,
  isLoadableMachO,
  MAC_ENTITLEMENTS_PATH,
  macSigningPlan,
  signMacApp,
  type SignContext,
} from '../scripts/sign-with-certificate.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function machO(fileType: number): Buffer {
  const header = Buffer.alloc(32)
  header.writeUInt32BE(0xcffaedfe, 0)
  header.writeUInt32LE(fileType, 12)
  return header
}

/** A miniature Electron app with a real tree, each code file carrying a real Mach-O header. */
function fakeApp(): { root: string; app: string } {
  const root = mkdtempSync(join(tmpdir(), 'idealize-sign-'))
  roots.push(root)
  const app = join(root, 'IDEalize V1.app')
  const file = (relative: string, bytes: Buffer | string = machO(2)): void => {
    const path = join(app, relative)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, bytes)
  }
  file('Contents/MacOS/IDEalize V1')
  file('Contents/Info.plist', 'plist')
  file('Contents/Frameworks/IDEalize V1 Helper (GPU).app/Contents/MacOS/IDEalize V1 Helper (GPU)')
  file('Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework', machO(6))
  file('Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib', machO(6))
  file('Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler')
  file('Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node', machO(8))
  file('Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')
  file('Contents/Resources/app.asar.unpacked/lib/main.js', 'console.log(1)')
  file('Contents/Resources/object.o', machO(1))
  symlinkSync('Versions/Current/Electron Framework', join(app, 'Contents/Frameworks/Electron Framework.framework/Electron Framework'))
  return { root, app }
}

function context(appOutDir: string, electronPlatformName = 'darwin'): SignContext {
  return { appOutDir, electronPlatformName, packager: { appInfo: { productFilename: 'IDEalize V1' } } }
}

describe('sign-with-certificate', () => {
  it('keeps the ad-hoc seal when no identity is named', () => {
    expect(certificateIdentity(context('/out/mac-universal'), {})).toBeUndefined()
    expect(certificateIdentity(context('/out/mac-universal'), { IDEALIZE_MAC_SIGN_IDENTITY: ' ' })).toBeUndefined()
  })

  it('signs only the merged macOS app', () => {
    const env = { IDEALIZE_MAC_SIGN_IDENTITY: 'ABC123' }
    expect(certificateIdentity(context('/out/mac-universal'), env)).toBe('ABC123')
    expect(certificateIdentity(context('/out/mac-universal-x64-temp'), env)).toBeUndefined()
    expect(certificateIdentity(context('/out/win-unpacked', 'win32'), env)).toBeUndefined()
  })

  it('recognises loadable code and skips everything else', () => {
    const { root } = fakeApp()
    const write = (name: string, bytes: Buffer): string => { const p = join(root, name); writeFileSync(p, bytes); return p }
    expect(isLoadableMachO(write('exe', machO(2)))).toBe(true)
    expect(isLoadableMachO(write('dylib', machO(6)))).toBe(true)
    expect(isLoadableMachO(write('node', machO(8)))).toBe(true)
    expect(isLoadableMachO(write('object', machO(1)))).toBe(false)
    expect(isLoadableMachO(write('text', Buffer.from('hello world, this is plain text....')))).toBe(false)
    const javaClass = Buffer.alloc(32)
    javaClass.writeUInt32BE(0xcafebabe, 0)
    javaClass.writeUInt32BE(52, 4)
    expect(isLoadableMachO(write('class', javaClass))).toBe(false)
    const fat = Buffer.alloc(64)
    fat.writeUInt32BE(0xcafebabe, 0)
    fat.writeUInt32BE(2, 4)
    fat.writeUInt32BE(32, 16)
    machO(6).copy(fat, 32)
    expect(isLoadableMachO(write('fat', fat))).toBe(true)
  })

  it('signs inside-out, entitles only apps and reaches native code under Resources', () => {
    const { app } = fakeApp()
    const plan = macSigningPlan(app)
    const names = plan.map(step => step.path.slice(app.length + 1))
    expect(names.at(-1)).toBe('')
    expect(plan.at(-1)?.entitled).toBe(true)
    for (const inner of [
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib',
      'Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler',
    ]) expect(names).toContain(inner)
    // A bundle's main executable signs with its bundle; plain files and objects never sign.
    expect(names).not.toContain('Contents/MacOS/IDEalize V1')
    expect(names).not.toContain('Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework')
    expect(names).not.toContain('Contents/Resources/app.asar.unpacked/lib/main.js')
    expect(names).not.toContain('Contents/Resources/object.o')
    const position = (name: string): number => names.indexOf(name)
    expect(position('Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/libEGL.dylib'))
      .toBeLessThan(position('Contents/Frameworks/Electron Framework.framework'))
    const entitled = plan.filter(step => step.entitled).map(step => step.path.slice(app.length + 1))
    expect(entitled).toEqual(['Contents/Frameworks/IDEalize V1 Helper (GPU).app', ''])
  })

  it('signs every pass with the hardened runtime and checks the result', () => {
    const { app } = fakeApp()
    const calls: (readonly string[])[] = []
    signMacApp(app, 'CERT', {
      run: (args) => {
        calls.push(args)
        if (args.includes('--requirements')) return { status: 0, output: 'designated => identifier "ai.projject.idealize.v1" and certificate root = H"39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3"' }
        if (args.includes('--display')) return { status: 0, output: 'CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1' }
        return { status: 0, output: '' }
      },
    })
    const signs = calls.filter(args => args.includes('--sign'))
    expect(signs.length).toBeGreaterThan(5)
    for (const args of signs) expect(args).toEqual(expect.arrayContaining(['--force', '--options', 'runtime', '--sign', 'CERT']))
    expect(signs.some(args => args.includes('--deep'))).toBe(false)
    expect(signs.at(-1)).toEqual(['--force', '--options', 'runtime', '--entitlements', MAC_ENTITLEMENTS_PATH, '--sign', 'CERT', app])
    expect(calls.some(args => args.join(' ') === `--verify --deep --strict ${app}`)).toBe(true)
  })

  it('stops the build when the runtime flag or the designated requirement is wrong', () => {
    expect(() => { assertHardened('CodeDirectory v=20400 size=304 flags=0x0(none) hashes=3+3') }).toThrow('without the hardened runtime')
    expect(() => { assertHardened('CodeDirectory v=20500 flags=0x10000(runtime)') }).not.toThrow()
    expect(() => { assertCertificateRequirement('designated => cdhash H"be9e930b00da033d14f6415c41be38f87a0192f9"') }).toThrow('changed form')
    expect(() => { assertCertificateRequirement('designated => identifier "x" and certificate root = H"39aa065ec4f9a9025aaad0dda3d74c8c1111fcd3"') }).not.toThrow()
  })

  it('the entitlements file carries what the app needs and nothing that reopens injection', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(MAC_ENTITLEMENTS_PATH, 'utf8')
    for (const key of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input',
    ]) expect(text).toContain(`<key>${key}</key>`)
    expect(text).not.toContain('allow-dyld-environment-variables')
    expect(text).not.toContain('get-task-allow')
  })
})
