// The skills folder over a real settings document and skill registry: a stored
// folder's `.skill` packages appear in `ctx.skills.list()` (unpacked folders
// beside them are ignored), a changed folder re-mounts, a package dropped in,
// replaced or removed reaches the registry through the folder watch, and a
// cleared folder leaves nothing registered.
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as skills from '../src/index.ts'

const NS = settingsNamespace('idealize-skills')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** An unpacked skill folder, the layout the plugin ignores. */
async function writeSkill(folder: string, name: string): Promise<void> {
  const directory = join(folder, name)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n\nBody.\n`)
}

const manifest = (name: string, description = name) => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody.\n`

/** A `.skill` package: a zip with the manifest at its root plus any extra files. */
async function writePackage(folder: string, name: string, description = name, extra: Record<string, string> = {}): Promise<string> {
  await mkdir(folder, { recursive: true })
  const files: Record<string, Uint8Array> = { 'SKILL.md': strToU8(manifest(name, description)) }
  for (const [path, text] of Object.entries(extra)) files[path] = strToU8(text)
  const path = join(folder, `${name}.skill`)
  await writeFile(path, zipSync(files))
  return path
}

/** Poll the registry until its skill names equal `expected`. */
async function expectSkills(ctx: Context, expected: string[]): Promise<void> {
  const deadline = Date.now() + 5_000
  for (;;) {
    const names = (await ctx.skills.list()).map(skill => skill.name).sort()
    if (JSON.stringify(names) === JSON.stringify(expected)) return
    if (Date.now() > deadline) {
      expect(names).toEqual(expected)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

async function boot(config: skills.SkillsConfig = {}) {
  root = await mkdtemp(join(tmpdir(), 'idealize-skills-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(skills, { unpackFolder: join(root, 'unpack'), ...config })
  const deadline = Date.now() + 5_000
  while (ctx.settings.get(NS) === undefined) {
    if (Date.now() > deadline) throw new Error('idealize-skills settings section never registered')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return { ctx, root }
}

describe('the skills folder', () => {
  it('registers the folder\'s packages once stored, ignores unpacked folders beside them, re-mounts on change, and clears when unset', async () => {
    const { ctx, root } = await boot()
    const first = join(root, 'skills-a')
    const second = join(root, 'skills-b')
    await writePackage(first, 'brief-writer')
    await writeSkill(first, 'deck-reviewer')
    await writeFile(join(first, 'notes.zip'), zipSync({ 'SKILL.md': strToU8(manifest('zipped')) }))
    await writePackage(second, 'deck-reviewer')

    await expectSkills(ctx, [])

    await ctx.settings.update(NS, { skillsFolder: first })
    await expectSkills(ctx, ['brief-writer'])
    expect((await stat(join(root, 'unpack', 'brief-writer', 'SKILL.md'))).isFile()).toBe(true)

    await ctx.settings.update(NS, { skillsFolder: second })
    await expectSkills(ctx, ['deck-reviewer'])
    // The unpacked copy of a package that is no longer in the folder is removed.
    await expect(stat(join(root, 'unpack', 'brief-writer'))).rejects.toThrow()

    await ctx.settings.replace(NS, { unpackFolder: join(root, 'unpack') })
    await expectSkills(ctx, [])
  })

  it('a package dropped in, replaced or removed reaches the registry without a settings change', async () => {
    const { ctx, root } = await boot()
    const folder = join(root, 'skills')
    await writePackage(folder, 'brief-writer', 'writes briefs')
    await ctx.settings.update(NS, { skillsFolder: folder })
    await expectSkills(ctx, ['brief-writer'])

    await writePackage(folder, 'deck-reviewer')
    await expectSkills(ctx, ['brief-writer', 'deck-reviewer'])

    await writePackage(folder, 'brief-writer', 'writes much longer briefs')
    const deadline = Date.now() + 5_000
    for (;;) {
      const skill = (await ctx.skills.list()).find(candidate => candidate.name === 'brief-writer')
      if (skill?.description === 'writes much longer briefs') break
      if (Date.now() > deadline) throw new Error(`replacement not seen: ${skill?.description}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }

    await rm(join(folder, 'deck-reviewer.skill'))
    await expectSkills(ctx, ['brief-writer'])
    await expect(stat(join(root, 'unpack', 'deck-reviewer'))).rejects.toThrow()
  }, 20_000)

  it('lifts a manifest out of a single top-level folder, keeps the resources, and skips a package without one', async () => {
    const { ctx, root } = await boot()
    const folder = join(root, 'skills')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'nested.skill'), zipSync({
      'nested/': new Uint8Array(),
      'nested/SKILL.md': strToU8(manifest('nested')),
      'nested/references/': new Uint8Array(),
      'nested/references/a.md': strToU8('# a\n'),
      '__MACOSX/nested/._SKILL.md': strToU8('junk'),
    }))
    await writeFile(join(folder, 'empty.skill'), zipSync({ 'README.md': strToU8('no manifest') }))
    await ctx.settings.update(NS, { skillsFolder: folder })
    await expectSkills(ctx, ['nested'])
    expect((await stat(join(root, 'unpack', 'nested', 'references', 'a.md'))).isFile()).toBe(true)
    await expect(stat(join(root, 'unpack', 'nested', '__MACOSX'))).rejects.toThrow()
    await expect(stat(join(root, 'unpack', 'empty'))).rejects.toThrow()
  })

  it('groups packages by subfolder: each registers, the catalogue lists every folder, and a repeated name resolves to the first folder', async () => {
    const { ctx, root } = await boot()
    const folder = join(root, 'skills')
    await writePackage(folder, 'brief-writer', 'root brief')
    await writePackage(join(folder, 'Codex'), 'deck-reviewer', 'codex deck')
    await writePackage(join(folder, 'Codex'), 'shared', 'codex shared')
    await writePackage(join(folder, 'claude'), 'shared', 'claude shared')
    await writePackage(join(folder, 'claude'), 'Bad Name', 'not kebab')
    await mkdir(join(folder, 'hermes'), { recursive: true })
    await writeSkill(join(folder, 'WIP'), 'unpacked-only')
    await ctx.settings.update(NS, { skillsFolder: folder })
    await expectSkills(ctx, ['brief-writer', 'deck-reviewer', 'shared'])
    // Folders order case-insensitively, so claude comes before Codex and its copy of the shared name wins.
    expect((await ctx.skills.list()).find(skill => skill.name === 'shared')?.description).toBe('claude shared')
    expect((await stat(join(root, 'unpack', 'Codex', 'deck-reviewer', 'SKILL.md'))).isFile()).toBe(true)
    expect((await stat(join(root, 'unpack', 'claude', 'shared', 'SKILL.md'))).isFile()).toBe(true)

    // The catalogue lists every package where it sits; a folder with no packages is absent.
    expect(await ctx.idealizeSkills.catalogue()).toEqual([
      { folder: '', skills: [{ package: 'brief-writer', name: 'brief-writer', description: 'root brief', manifest: true }] },
      { folder: 'claude', skills: [
        { package: 'Bad Name', name: 'Bad Name', description: 'not kebab', manifest: true },
        { package: 'shared', name: 'shared', description: 'claude shared', manifest: true },
      ] },
      { folder: 'Codex', skills: [
        { package: 'deck-reviewer', name: 'deck-reviewer', description: 'codex deck', manifest: true },
        { package: 'shared', name: 'shared', description: 'codex shared', manifest: true },
      ] },
    ])

    // A package dropped into a subfolder arrives; removing the last package of a folder removes its unpacked copy.
    await writePackage(join(folder, 'hermes'), 'late-arrival')
    await expectSkills(ctx, ['brief-writer', 'deck-reviewer', 'late-arrival', 'shared'])
    await rm(join(folder, 'claude'), { recursive: true, force: true })
    // The name set does not change, so wait for the other copy to take over.
    const deadline = Date.now() + 5_000
    for (;;) {
      const shared = (await ctx.skills.list()).find(skill => skill.name === 'shared')
      if (shared?.description === 'codex shared') break
      if (Date.now() > deadline) throw new Error(`Codex copy not seen: ${shared?.description}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    await expectSkills(ctx, ['brief-writer', 'deck-reviewer', 'late-arrival', 'shared'])
    await expect(stat(join(root, 'unpack', 'claude'))).rejects.toThrow()

    // Nothing set: the catalogue is empty even though the unpack folder still exists.
    await ctx.settings.replace(NS, { unpackFolder: join(root, 'unpack') })
    await expectSkills(ctx, [])
    expect(await ctx.idealizeSkills.catalogue()).toEqual([])
  }, 30_000)

  it('lists a package whose manifest it cannot read by its file name, unoffered', async () => {
    const { root } = await boot()
    const folder = join(root, 'skills')
    const unpack = join(root, 'unpack-b')
    await writePackage(folder, 'good', 'fine')
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, 'broken.skill'), zipSync({ 'SKILL.md': strToU8('---\nname: broken\ndescription: {oops\n---\n') }))
    await writeFile(join(folder, 'nameless.skill'), zipSync({ 'SKILL.md': strToU8('---\ndescription: only\n---\n') }))
    await skills.syncPackages(folder, unpack)
    expect(await skills.readCatalogue(folder, unpack)).toEqual([{ folder: '', skills: [
      { package: 'broken', name: 'broken', description: '', manifest: false },
      { package: 'good', name: 'good', description: 'fine', manifest: true },
      { package: 'nameless', name: 'nameless', description: '', manifest: false },
    ] }])
  })

  it('mounts nothing for a folder that is missing or not a directory', async () => {
    const { ctx, root } = await boot()
    await writeFile(join(root, 'not-a-folder'), 'x')
    await ctx.settings.update(NS, { skillsFolder: join(root, 'absent') })
    await expectSkills(ctx, [])
    await ctx.settings.update(NS, { skillsFolder: join(root, 'not-a-folder') })
    await expectSkills(ctx, [])
  })

  it('mounts the composition default and disposes the provider with the plugin', async () => {
    root = await mkdtemp(join(tmpdir(), 'idealize-skills-'))
    const folder = join(root, 'skills')
    await writePackage(folder, 'seeded')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.yaml'), watch: false })
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(skills, { skillsFolder: folder, unpackFolder: join(root, 'unpack') })
    await expectSkills(ctx, ['seeded'])
    await fiber.dispose()
    await expectSkills(ctx, [])
  })
})

describe('packageFiles', () => {
  it('drops entries that would escape the unpack folder', () => {
    const files = skills.packageFiles(zipSync({
      'SKILL.md': strToU8(manifest('safe')),
      '../evil.md': strToU8('x'),
      'ok/../../evil2.md': strToU8('x'),
      'C:/evil3.md': strToU8('x'),
      'references/fine.md': strToU8('x'),
    }))
    expect([...files!.keys()].sort()).toEqual(['SKILL.md', join('references', 'fine.md')])
  })
})
