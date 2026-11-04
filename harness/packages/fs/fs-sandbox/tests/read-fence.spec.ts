/**
 * The read fence a confined chat's file tools hit: the tools run in the app,
 * outside the kernel sandbox, so without this a chat's `read` could return a
 * key its shell could not touch.
 */

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import { SandboxedFileSystem } from '@deepseek-ai/dsh-fs-sandbox'

let base: string
let home: string
let dataHome: string
let project: string
let ctx: Context

function exec(name: string, args: Record<string, unknown>, cwd = project): never {
  return {
    name,
    arguments: args,
    callId: 'call',
    signal: new AbortController().signal,
    agent: { session: { id: 'session-x', header: { cwd }, events: [] } },
  } as never
}

async function gate(call: never): Promise<{ kind: string; reason?: string }> {
  // @ts-expect-error A bare context stands in for the tool runtime's scope here.
  return ctx.waterfall(ctx, 'tools/pre-execute', call, () => Promise.resolve({ kind: 'allow' } as const)) as never
}

async function boot(mode: SandboxMode): Promise<void> {
  ctx = new Context()
  await ctx.plugin(SandboxPolicyService, { mode, workspaceRoot: project })
  await ctx.plugin(SandboxedFileSystem, { cwd: project })
}

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(homedir(), '.dsh-fence-')))
  home = join(base, 'home')
  dataHome = join(home, 'Library', 'Application Support', 'IDEalize Test', 'harness')
  project = join(home, 'project')
  await mkdir(project, { recursive: true })
  await mkdir(dataHome, { recursive: true })
  await mkdir(join(home, '.ssh'))
  await writeFile(join(home, '.ssh', 'id_ed25519'), 'made-up')
  await writeFile(join(dataHome, '.credentials.yaml'), 'made-up')
  await writeFile(join(project, 'README.md'), 'hello')
  vi.stubEnv('HOME', home)
  vi.stubEnv('DSH_HOME', dataHome)
})

afterEach(async () => {
  await ctx?.fiber.dispose()
  vi.unstubAllEnvs()
  await rm(base, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('the read fence', () => {
  it.each(['read', 'read_image', 'edit', 'write'])('refuses %s of a key by file_path', async (tool) => {
    await boot('workspace-write')
    expect((await gate(exec(tool, { file_path: join(home, '.ssh', 'id_ed25519') }))).kind).toBe('deny')
    expect((await gate(exec(tool, { file_path: join(dataHome, '.credentials.yaml') }))).kind).toBe('deny')
  })

  it('refuses str_replace_editor, grep and glob naming a closed location', async () => {
    await boot('workspace-write')
    expect((await gate(exec('str_replace_editor', { command: 'view', path: join(dataHome, '.credentials.yaml') }))).kind).toBe('deny')
    expect((await gate(exec('grep', { pattern: 'x', path: dataHome }))).kind).toBe('deny')
    expect((await gate(exec('glob', { pattern: '*', path: join(home, '.ssh', 'id_ed25519') }))).kind).toBe('deny')
  })

  it('refuses a symlink in the project by where it lands', async () => {
    await boot('workspace-write')
    await symlink(join(home, '.ssh', 'id_ed25519'), join(project, 'innocent.txt'))
    expect((await gate(exec('read', { file_path: join(project, 'innocent.txt') }))).kind).toBe('deny')
    expect((await gate(exec('read', { file_path: 'innocent.txt' }))).kind).toBe('deny')
  })

  it('refuses a read-only chat too', async () => {
    await boot('read-only')
    expect((await gate(exec('read', { file_path: join(home, '.ssh', 'id_ed25519') }))).kind).toBe('deny')
  })

  it('allows ordinary files and other tools', async () => {
    await boot('workspace-write')
    expect((await gate(exec('read', { file_path: 'README.md' }))).kind).toBe('allow')
    expect((await gate(exec('grep', { pattern: 'x' }))).kind).toBe('allow')
    expect((await gate(exec('bash', { command: 'cat ~/.ssh/id_ed25519' }))).kind).toBe('allow')
  })

  it('refuses a grep that starts above the data folder, and a glob from there is names only', async () => {
    await boot('workspace-write')
    expect((await gate(exec('grep', { pattern: 'x' }, home))).kind).toBe('deny')
    expect((await gate(exec('glob', { pattern: '*' }, home))).kind).toBe('allow')
  })

  it('allows everything under full access', async () => {
    await boot('danger-full-access')
    expect((await gate(exec('read', { file_path: join(home, '.ssh', 'id_ed25519') }))).kind).toBe('allow')
    expect((await gate(exec('grep', { pattern: 'x' }, home))).kind).toBe('allow')
  })
})
