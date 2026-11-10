import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = resolve(import.meta.dirname, '..', '..')
const release = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')

interface Step { readonly uses?: string; readonly run?: string; readonly name?: string; readonly env?: Record<string, string>; readonly if?: string }
interface Job { readonly steps: readonly Step[]; readonly permissions?: Record<string, string>; readonly needs?: string }
const workflow = parse(release) as { permissions: Record<string, string>; jobs: Record<string, Job> }
const jobs = workflow.jobs

function jobNeedingCertificate(job: Job): boolean {
  return JSON.stringify(job).includes('secrets.')
}

describe('release workflow', () => {
  it.each([['release.yml', release], ['ci.yml', ci]])('%s pins every action to a full commit', (_name, text) => {
    const uses = [...text.matchAll(/uses:\s*(\S+)/gu)].map(match => match[1] ?? '')
    expect(uses.length).toBeGreaterThan(3)
    for (const action of uses) expect(action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u)
  })

  it('publishes macOS from a job that never sees the certificate', () => {
    const publish = jobs['publish-macos']
    expect(publish?.needs).toBe('build-macos')
    expect(publish?.permissions).toEqual({ contents: 'write' })
    expect(publish && jobNeedingCertificate(publish)).toBe(false)
    expect(JSON.stringify(publish)).not.toContain('IDEALIZE_MAC')
    expect(JSON.stringify(publish)).not.toContain('security ')
    expect(publish?.steps.some(step => step.uses?.startsWith('softprops/action-gh-release@'))).toBe(true)
    expect(publish?.steps.some(step => step.uses?.startsWith('actions/checkout@'))).toBe(false)
  })

  it('the job holding the certificate cannot publish, and clears it before uploading', () => {
    const build = jobs['build-macos']
    expect(build && jobNeedingCertificate(build)).toBe(true)
    expect(build?.permissions).toEqual({ contents: 'read' })
    expect(build?.steps.some(step => step.uses?.startsWith('softprops/action-gh-release@'))).toBe(false)
    const names = build?.steps.map(step => step.name ?? step.uses ?? step.run ?? '') ?? []
    const check = names.indexOf('Release check')
    const clear = names.indexOf('Remove the signing certificate before anything leaves this job')
    const upload = names.findIndex(name => name.startsWith('actions/upload-artifact@'))
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(clear)
    expect(clear).toBeLessThan(upload)
    expect(build?.steps[clear]?.if).toBe('always()')
  })

  it('stops a release with no certificate, because installed copies would refuse it', () => {
    expect(release).toContain('exit 1; fi\n          keychain=')
    expect(release).not.toContain("if: env.IDEALIZE_MAC_SIGN_IDENTITY != ''")
  })

  it('builds and publishes macOS only, because the PC team ships Windows from its own fork', () => {
    // JJ, 6 Nov 2026: Windows installs move to the PC team's version.
    expect(Object.keys(jobs).sort()).toEqual(['build-macos', 'publish-macos'])
    expect(release).not.toContain('dist:win')
  })

  it('grants nothing by default', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })
})
