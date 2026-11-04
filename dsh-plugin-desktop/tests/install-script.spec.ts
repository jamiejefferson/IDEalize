import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RELEASE_REQUIREMENT } from '../src/update-verify.ts'

const SCRIPT = resolve(import.meta.dirname, '..', '..', 'install.sh')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Scenario {
  readonly codesignStatus?: number
  readonly sums?: string | null
}

/** Run install.sh with its disk, signature and copy tools replaced by recording stand-ins. */
function install(scenario: Scenario): { status: number | null; stderr: string; stdout: string; root: string; calls: string[]; app: string } {
  const root = mkdtempSync(join(tmpdir(), 'idealize-install-'))
  roots.push(root)
  const bin = join(root, 'bin')
  const release = join(root, 'release')
  const apps = join(root, 'Applications')
  mkdirSync(bin)
  mkdirSync(release)
  mkdirSync(apps)
  writeFileSync(join(release, 'IDEalize-V1-mac.dmg'), 'disk image bytes')
  if (scenario.sums !== null) writeFileSync(join(release, 'SHA256SUMS-mac.txt'), scenario.sums ?? '')
  const app = join(apps, 'IDEalize V1.app')
  mkdirSync(join(app, 'Contents'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'old-copy'), 'the copy already installed')
  const log = join(root, 'calls.log')
  const stub = (name: string, body: string): void => {
    writeFileSync(join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  stub('uname', 'echo Darwin')
  stub('hdiutil', `if [ "$1" = attach ]; then
  while [ $# -gt 0 ]; do if [ "$1" = -mountpoint ]; then mp="$2"; fi; shift; done
  mkdir -p "$mp/IDEalize V1.app/Contents"
fi`)
  stub('codesign', `exit ${String(scenario.codesignStatus ?? 0)}`)
  stub('ditto', 'mkdir -p "$2"; cp -R "$1/" "$2/"; echo new > "$2/Contents/new-copy"')
  stub('xattr', '')
  stub('open', '')
  stub('osascript', '')
  stub('sudo', 'exit 1')
  const result = spawnSync('/bin/bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      IDEALIZE_INSTALL_APPS_DIR: apps,
      IDEALIZE_INSTALL_RELEASE_URL: `file://${release}`,
      IDEALIZE_INSTALL_NO_LAUNCH: '1',
    },
  })
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
    root,
    app,
    calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
  }
}

function sha256(text: string): string {
  const result = spawnSync('/usr/bin/shasum', ['-a', '256'], { input: text, encoding: 'utf8' })
  return result.stdout.split(' ')[0] ?? ''
}

const GOOD_SUMS = `${sha256('disk image bytes')}  IDEalize-V1-mac.dmg\n`

function expectUntouched(run: ReturnType<typeof install>): void {
  expect(run.status).toBe(1)
  expect(run.calls.some(call => call.startsWith('ditto '))).toBe(false)
  expect(readFileSync(join(run.app, 'Contents', 'old-copy'), 'utf8')).toBe('the copy already installed')
  expect(run.calls.some(call => call.startsWith('xattr '))).toBe(false)
}

describe.runIf(process.platform === 'darwin')('install.sh', () => {
  it('installs a release that passes the checksum and the certificate', () => {
    const run = install({ sums: GOOD_SUMS })
    expect(run.status).toBe(0)
    const check = run.calls.find(call => call.startsWith('codesign '))
    expect(check).toContain(`--test-requirement==${RELEASE_REQUIREMENT}`)
    expect(check).toContain('--deep --strict')
    expect(run.calls.findIndex(call => call.startsWith('codesign ')))
      .toBeLessThan(run.calls.findIndex(call => call.startsWith('ditto ')))
    expect(existsSync(join(run.app, 'Contents', 'new-copy'))).toBe(true)
  })

  it('refuses an app the release certificate did not sign, before touching the installed copy', () => {
    const run = install({ sums: GOOD_SUMS, codesignStatus: 3 })
    expectUntouched(run)
    expect(run.stderr).toContain('could not confirm this download is genuine')
    expect(run.stderr).toContain('idealize.projject.ai')
  })

  it('refuses a download that does not match the checksum file', () => {
    const run = install({ sums: `${'a'.repeat(64)}  IDEalize-V1-mac.dmg\n` })
    expectUntouched(run)
    expect(run.stderr).toContain('does not match')
    expect(run.calls.some(call => call.startsWith('hdiutil attach'))).toBe(false)
  })

  it('refuses a checksum file that does not name the image', () => {
    expectUntouched(install({ sums: `${'a'.repeat(64)}  something-else.dmg\n` }))
  })

  it('carries on to the certificate check when the release has no checksum file', () => {
    const run = install({ sums: null })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('publishes no checksum')
    expect(run.calls.some(call => call.startsWith('codesign '))).toBe(true)
  })
})
