/**
 * The attacks on Powell's Open button: a reply or a provider's error naming
 * something that runs, or a link that hands off to another app.
 */

import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { explainFailure } from '../src/failure.ts'
import { checkOpenTarget, openButtonLabel } from '../src/open-target.ts'

let base: string
let project: string
let outside: string

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'powell-open-')))
  project = join(base, 'project')
  outside = join(base, 'outside')
  await mkdir(project)
  await mkdir(outside)
  await writeFile(join(project, 'notes.md'), 'hello')
  await writeFile(join(outside, 'secret.md'), 'hello')
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('checkOpenTarget', () => {
  it('opens an https page', async () => {
    expect(await checkOpenTarget('https://example.com/a?b=1', [])).toEqual({ kind: 'url', url: 'https://example.com/a?b=1' })
  })

  it.each([
    'http://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'ssh://example.com',
    'vscode://file/x',
    'x-apple.systempreferences:com.apple.preference.security',
    'mailto:a@example.com',
    'HTTP://EXAMPLE.COM',
    'https://bank.example@elsewhere.test/',
  ])('refuses %s', async (target) => {
    expect(await checkOpenTarget(target, [project])).toBeUndefined()
  })

  it('opens a file or folder in a project', async () => {
    expect(await checkOpenTarget(join(project, 'notes.md'), [project])).toEqual({ kind: 'path', path: join(project, 'notes.md') })
    expect(await checkOpenTarget(project, [project])).toEqual({ kind: 'path', path: project })
  })

  it('refuses a file outside the projects, and a relative or missing path', async () => {
    expect(await checkOpenTarget(join(outside, 'secret.md'), [project])).toBeUndefined()
    expect(await checkOpenTarget('notes.md', [project])).toBeUndefined()
    expect(await checkOpenTarget(join(project, 'missing.md'), [project])).toBeUndefined()
    expect(await checkOpenTarget(join(project, '..', 'outside', 'secret.md'), [project])).toBeUndefined()
  })

  it.each(['x.command', 'x.app', 'x.pkg', 'x.scpt', 'x.terminal', 'x.workflow', 'x.js', 'x.bat'])('refuses a %s in a project', async (name) => {
    await writeFile(join(project, name), '#!/bin/sh\n')
    expect(await checkOpenTarget(join(project, name), [project])).toBeUndefined()
  })

  it('refuses an executable with no extension', async () => {
    await writeFile(join(project, 'run'), '#!/bin/sh\n')
    await chmod(join(project, 'run'), 0o755)
    expect(await checkOpenTarget(join(project, 'run'), [project])).toBeUndefined()
  })

  it('judges a link by where it lands', async () => {
    await writeFile(join(project, 'evil.command'), '#!/bin/sh\n')
    await symlink(join(project, 'evil.command'), join(project, 'readme.md'))
    await symlink(join(outside, 'secret.md'), join(project, 'elsewhere.md'))
    expect(await checkOpenTarget(join(project, 'readme.md'), [project])).toBeUndefined()
    expect(await checkOpenTarget(join(project, 'elsewhere.md'), [project])).toBeUndefined()
  })

  it('does not accept a sibling that shares a prefix with a project', async () => {
    await mkdir(`${project}-other`)
    await writeFile(join(`${project}-other`, 'a.md'), 'x')
    expect(await checkOpenTarget(join(`${project}-other`, 'a.md'), [project])).toBeUndefined()
  })
})

describe('openButtonLabel', () => {
  it('names the destination', () => {
    expect(openButtonLabel('https://www.example.com/a/b')).toBe('Open www.example.com')
    expect(openButtonLabel('/work/project/notes.md')).toBe('Open notes.md')
  })
})

describe('the Add credit link', () => {
  it('goes to the known page for a known provider', () => {
    expect(explainFailure({ status: 402, message: 'out of credit' }, 'openrouter').link?.url).toBe('https://openrouter.ai/settings/credits')
  })

  it('ignores a link in the error text', () => {
    const failure = { status: 402, message: 'more credits needed at https://evil.test/credits/buy' }
    expect(explainFailure(failure, 'somewhere').link).toBeUndefined()
    expect(explainFailure(failure, 'openrouter').link?.url).toBe('https://openrouter.ai/settings/credits')
    expect(explainFailure(failure).link).toBeUndefined()
  })
})
