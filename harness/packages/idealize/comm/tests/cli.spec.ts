/**
 * The `idealize` command-line face, driven as the shell drives it: the built
 * entry in a real subprocess. It executes at module scope, so this is the only
 * way to exercise it without booting the CLI inside the test process.
 * Skips when lib/ is not built (`pnpm --filter @idealize/comm bundle`).
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Wire } from '../src/wire.ts'

const run = promisify(execFile)
// vitest runs from the repo root, so resolve the artifact repo-relatively.
const CLI = resolve('packages/idealize/comm/lib/cli.js')
const built = existsSync(CLI)

/** One CLI run with no host to reach, so only the grammar answers. */
async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      env: { ...process.env, IDEALIZE_HOST: '', DSH_IDEALIZE_HOST: '', IDEALIZE_SESSION_ID: 't-spec' },
      timeout: 20_000,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

describe.skipIf(!built)('the idealize CLI', () => {
  it('prints its own grammar with no arguments, and on help', async () => {
    const bare = await cli([])
    expect(bare.stdout).toContain('idealize')
    const help = await cli(['help'])
    expect(help.stdout).toBe(bare.stdout)
    expect((await cli(['--help'])).stdout).toBe(bare.stdout)
  })

  it('names the command it does not know', async () => {
    const unknown = await cli(['fly'])
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain("unknown command 'fly'")
  })

  it('states the usage of a command called with too little', async () => {
    expect((await cli(['send'])).stderr).toContain('usage: idealize send <session> <text>')
    expect((await cli(['task', 'ship it'])).stderr).toContain('usage: idealize task <goal> --to <session>')
    expect((await cli(['rung', 'askbar'])).stderr).toContain(Wire.rungs.join('|'))
  })
})
