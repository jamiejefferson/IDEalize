// Composition smoke (AC-19): over real storage and tool plugins, a scratch
// vault is scaffolded and scanned from just the configured folder + the
// packaged policy, the scan lands durably with its policy version, and
// docs_search answers a hit through the real tool registry.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as docPolicy from '../src/index.ts'
import { RULESET_VERSION } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('doc-policy real composition', () => {
  it('scans a scratch vault, records the scan durably, and serves docs_search', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-doc-policy-comp-'))
    const vault = join(root, 'vault')
    await mkdir(vault, { recursive: true })

    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storages') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(docPolicy, { documentationFolder: vault })

    // The init scan scaffolds the canonical structure; add a project note and rescan.
    await ctx.docPolicy.scan()
    await mkdir(join(vault, 'Projects', 'acme'), { recursive: true })
    await writeFile(
      join(vault, 'Projects', 'acme', '_index.md'),
      docPolicy.projectNoteFor('acme', join(root, 'repo'), '2026-08-24')
        .replace('## State\n', '## State\n\nWaiting on the heliotrope pigment decision.\n'),
    )
    const record = await ctx.docPolicy.scan()
    expect(record?.policyVersion).toBe(RULESET_VERSION.id)
    expect(record?.findings).toEqual([])

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('docs-search-1'),
      name: 'docs_search',
      arguments: { query: 'heliotrope pigment' },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected docs_search success')
    const value = result.value as { hits: Array<{ path: string; snippet: string }> }
    expect(value.hits.map(hit => hit.path)).toEqual(['Projects/acme/_index.md'])
    expect(value.hits[0]!.snippet).toContain('heliotrope')

    // DOC-04/07: the scan history landed in the storage domain with its policy version.
    const domain = ctx.storageDomain.get('idealize_docs')
    expect(domain).toBeDefined()
    const deadline = Date.now() + 2_000
    let recorded = 0
    while (Date.now() < deadline) {
      recorded = domain!.table('scans').size
      if (recorded > 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    expect(recorded).toBeGreaterThan(0)
    const rows = [...domain!.table('scans').entries()]
    expect(rows.every(([, row]) => (row as { policyVersion: string }).policyVersion === RULESET_VERSION.id)).toBe(true)

    // DOC-08: the state surface reports folder + scan state only.
    const state = ctx.docPolicy.state()
    expect(state.configured).toBe(true)
    expect(state.folder).toBe(vault)
    expect(state.lastScan?.policyVersion).toBe(RULESET_VERSION.id)
  }, 30_000)

  it('keeps the last scan while the folder is unchanged, and rescans after an edit', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-doc-policy-skip-'))
    const vault = join(root, 'vault')
    await mkdir(vault, { recursive: true })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(Storage)
    await ctx.plugin(StorageJson, { root: join(root, 'storages') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(docPolicy, { documentationFolder: vault })

    const first = await ctx.docPolicy.scan()
    const scans = ctx.storageDomain.get('idealize_docs')!.table('scans')
    const recordedAfterFirst = scans.size

    // Unchanged folder: the same record object comes back and no history row is added.
    expect(await ctx.docPolicy.scan()).toBe(first)
    expect(await ctx.docPolicy.scan()).toBe(first)
    expect(scans.size).toBe(recordedAfterFirst)

    await writeFile(join(vault, 'Reference', 'verdigris.md'), '# Verdigris\n\nA copper patina.\n')
    const second = await ctx.docPolicy.scan()
    expect(second).not.toBe(first)
    expect(second?.docCount).toBe((first?.docCount ?? 0) + 1)
    expect(scans.size).toBe(recordedAfterFirst + 1)
    expect((await ctx.docPolicy.search('copper patina', 5)).map(hit => hit.path)).toEqual(['Reference/verdigris.md'])
  }, 30_000)

  it('lets a session flush return before its rescan finishes, and settles the rescan at disposal', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-doc-policy-flush-'))
    const vault = join(root, 'vault')
    await mkdir(vault, { recursive: true })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(docPolicy, { documentationFolder: vault })
    await fiber.await()
    await ctx.docPolicy.scan()
    // A slow scan must not hold the flush: the barrier a turn's first step waits on.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const original = ctx.docPolicy.scan.bind(ctx.docPolicy)
    let scans = 0
    ctx.docPolicy.scan = async () => { scans += 1; await gate; return original() }
    const session = { header: { cwd: root } } as never
    const flushed = await Promise.race([
      ctx.parallel('session/flush', session).then(() => 'flushed'),
      new Promise<string>((resolve) => { setTimeout(() => { resolve('held') }, 500) }),
    ])
    expect(flushed).toBe('flushed')
    expect(scans).toBe(1)
    // Disposal waits for the detached rescan rather than abandoning it.
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(disposed).toBe(false)
    release()
    await disposal
    expect(disposed).toBe(true)
  }, 30_000)

  it('answers a configuration note instead of failing when no folder is set', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(docPolicy, {})
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('docs-search-2'),
      name: 'docs_search',
      arguments: { query: 'anything' },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected docs_search success')
    const value = result.value as { hits: unknown[]; note?: string }
    expect(value.hits).toEqual([])
    expect(value.note).toContain('No documentation folder')
    expect(ctx.docPolicy.state()).toEqual({ configured: false, policyVersion: RULESET_VERSION.id })
  }, 30_000)
})
