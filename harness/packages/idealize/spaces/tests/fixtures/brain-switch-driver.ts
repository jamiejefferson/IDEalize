#!/usr/bin/env node
/**
 * Snapshot-only Loader driver: two turns on ONE chat with a brain switch
 * between them, so the persisted log carries the model request from before the
 * switch beside the one from after it.
 *
 * The switch goes over the wire — `POST /idealize/spaces/select`, loopback and
 * `x-idealize-auth` and all — because that is the only way the product ever
 * records one. Nothing else about the chat changes: the agent preset stays as
 * the first turn's history was produced under, which is the started-chat case
 * the preset lock leaves for the log to answer.
 *
 * Argv: `<config-path> <brain> <instructions>`. An empty instructions argument
 * is the brain that carries no standing instructions.
 * @module brain-switch-driver
 */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import type {} from '@deepseek-ai/dsh-host-webserver'

const NAME = 'brain-switch-driver'
const [configPath, brain, instructions] = process.argv.slice(2)
if (configPath === undefined || brain === undefined || instructions === undefined) {
  throw new Error(`${NAME}: expected <config-path> <brain> <instructions>`)
}

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const before = await runFixtureTurn(ctx, { task: 'Introduce yourself.' })
  process.stdout.write(`${JSON.stringify({ ...before, phase: 'before' })}\n`)

  const [agent] = ctx.agents.roots()
  if (agent === undefined) throw new Error(`${NAME}: the composition published no root agent`)
  const response = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/idealize/spaces/select`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-idealize-auth': '1' },
    body: JSON.stringify({ sessionId: String(agent.session.id), space: 'chat', brain, instructions }),
  })
  const recorded = await response.json() as { recorded?: { brain?: boolean } }
  if (recorded.recorded?.brain !== true) {
    throw new Error(`${NAME}: the select route recorded no brain: ${JSON.stringify(recorded)}`)
  }

  const after = await runFixtureTurn(ctx, { task: 'Introduce yourself again.' })
  process.stdout.write(`${JSON.stringify({ ...after, phase: 'after' })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
