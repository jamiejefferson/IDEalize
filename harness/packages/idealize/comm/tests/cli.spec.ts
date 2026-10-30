/**
 * The `idealize` command-line face, driven as the shell drives it: the built
 * entry in a real subprocess. It executes at module scope, so this is the only
 * way to exercise it without booting the CLI inside the test process.
 * Skips when lib/ is not built (`pnpm --filter @idealize/comm bundle`).
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Wire } from '../src/wire.ts'

const run = promisify(execFile)
// vitest runs from the repo root, so resolve the artifact repo-relatively.
const CLI = resolve('packages/idealize/comm/lib/cli.js')
const built = existsSync(CLI)

/** One CLI run with no host to reach, so only the grammar answers, unless `env` names one. */
async function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], {
      env: { ...process.env, IDEALIZE_HOST: '', DSH_IDEALIZE_HOST: '', IDEALIZE_SESSION_ID: 't-spec', ...env },
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
    expect((await cli(['turn', 'done'])).stderr).toContain('turn needs one of open|start|stop|close')
  })

  it('reports a turn as the chat whose shell it runs in, and prints nothing', async () => {
    // What a Claude Code Stop hook runs: the host must hear which chat, proved by its key.
    const heard: { url: string | undefined; session: unknown; key: unknown; body: unknown }[] = []
    const host = createServer((req, res) => {
      let text = ''
      req.on('data', (chunk: Buffer) => { text += chunk.toString() })
      req.on('end', () => {
        heard.push({ url: req.url, session: req.headers['x-idealize-session'], key: req.headers['x-idealize-key'], body: JSON.parse(text) })
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      })
    })
    await new Promise<void>((done) => { host.listen(0, '127.0.0.1', done) })
    try {
      const origin = `http://127.0.0.1:${String((host.address() as AddressInfo).port)}`
      const result = await cli(['turn', 'stop'], { DSH_IDEALIZE_HOST: origin, DSH_SESSION_ID: 'session-1', DSH_IDEALIZE_KEY: 'k-1' })
      expect(result).toEqual({ code: 0, stdout: '', stderr: '' })
      expect(heard).toEqual([{ url: '/idealize/comm', session: 'session-1', key: 'k-1', body: { command: 'turn', turn: 'stop', from: 'session-1' } }])
    } finally {
      await new Promise((done) => { host.close(done) })
    }
  })
})
