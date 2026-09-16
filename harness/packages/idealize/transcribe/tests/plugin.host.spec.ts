/**
 * The plugin on a real composition booted through the vendored Loader from a
 * written `cordis.yml`: the web server and `@idealize/transcribe` over a
 * scratch harness home.
 *
 * - The state route publishes the on-device provider the composition mounted,
 *   named by the model the configuration chose.
 * - A capture below the configured floor is refused by the route, so the
 *   bounds reach the wire and not just the runtime.
 * - The routes and the provider go away with the composition.
 *
 * Nothing here fetches a model: readiness answers before any file is asked for.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import * as Transcribe from '../src/index.ts'
import { PREPARE_PATH, STATE_PATH, TRANSCRIBE_PATH } from '../src/routes.ts'

const AUTH = { 'x-idealize-auth': '1' }

let root: string | undefined
let context: Context | undefined
let previousHome: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a `cordis.yml` naming the two plugins, and boot it through the Loader. */
async function boot(config: string[] = []): Promise<{ ctx: Context; origin: string }> {
  root = await mkdtemp(join(tmpdir(), 'idealize-transcribe-'))
  previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@idealize/transcribe'",
    ...(config.length === 0 ? [] : ['  config:', ...config]),
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@idealize/transcribe', Transcribe],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, origin: `http://127.0.0.1:${String(ctx.webServer.port)}` }
}

/** A capture of `ms` milliseconds at 16 kHz, as the bytes the route reads. */
function body(ms: number): ArrayBuffer {
  return new Float32Array(Math.round((ms / 1000) * 16_000)).buffer
}

describe('the composed plugin', () => {
  it('mounts the on-device provider and publishes its descriptor', async () => {
    const { origin } = await boot()
    const payload = await (await fetch(`${origin}${STATE_PATH}`)).json() as {
      providers: { id: string; label: string; location: string; model: string; sampleRate: number }[]
      readiness: unknown
    }
    expect(payload.providers).toEqual([{
      id: 'local-whisper',
      label: 'On-device whisper',
      location: 'on-device',
      model: 'onnx-community/whisper-base.en',
      sampleRate: 16_000,
    }])
    // Nothing has asked for the model, so it is not ready and nothing downloaded.
    expect(payload.readiness).toEqual({ state: 'preparing', percent: 0 })
  })

  it('runs the model the configuration names', async () => {
    const { origin } = await boot(["    model: 'onnx-community/whisper-tiny.en'"])
    const payload = await (await fetch(`${origin}${STATE_PATH}`)).json() as { providers: { model: string }[] }
    expect(payload.providers[0]?.model).toBe('onnx-community/whisper-tiny.en')
  })

  it('refuses a misspelt quantisation at config load rather than at the first capture', async () => {
    await expect(boot(['    dtype: q9'])).rejects.toThrow()
  })

  it('holds a capture on the wire to the configured floor', async () => {
    const { origin } = await boot(['    minCaptureMs: 1000'])
    const response = await fetch(`${origin}${TRANSCRIBE_PATH}`, { method: 'POST', headers: AUTH, body: body(500) })
    expect(response.status).toBe(422)
    expect((await response.json() as { refusal: string }).refusal).toBe('too-short')
  })

  it('fences the prepare route the way the other mutating routes are fenced', async () => {
    const { origin } = await boot()
    expect((await fetch(`${origin}${PREPARE_PATH}`, { method: 'POST' })).status).toBe(403)
  })

  it('takes the routes away with the composition', async () => {
    const { ctx, origin } = await boot()
    await ctx.fiber.dispose()
    context = undefined
    await expect(fetch(`${origin}${STATE_PATH}`)).rejects.toThrow()
  })
})
