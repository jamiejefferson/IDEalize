import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_CONFIG, presetOfRole, roleGuide, roleOfPreset, seedRolePreset, withRolePersona } from '../src/roles.ts'

describe('role mapping', () => {
  it('maps the configured preset to the coordinator role and back', () => {
    expect(roleOfPreset('project-agent', DEFAULT_ROLE_CONFIG)).toBe('project-agent')
    expect(roleOfPreset('lead-agent', DEFAULT_ROLE_CONFIG)).toBeUndefined()
    expect(roleOfPreset('standard', DEFAULT_ROLE_CONFIG)).toBeUndefined()
    expect(roleOfPreset(undefined, DEFAULT_ROLE_CONFIG)).toBeUndefined()
    expect(presetOfRole('project-agent', { projectAgentPreset: 'pm', studioAgentPreset: 'studio' })).toBe('pm')
  })

  it('maps the Studio preset to the Studio role and back, independently of the project one', () => {
    expect(roleOfPreset('studio-agent', DEFAULT_ROLE_CONFIG)).toBe('studio-agent')
    expect(presetOfRole('studio-agent', DEFAULT_ROLE_CONFIG)).toBe('studio-agent')
    expect(presetOfRole('studio-agent', { projectAgentPreset: 'pm', studioAgentPreset: 'chief' })).toBe('chief')
  })
})

describe('roleGuide', () => {
  it('ships the coordinator guide with the frontmatter stripped', async () => {
    const project = await roleGuide('project-agent')
    expect(project?.startsWith('You are the **project agent**')).toBe(true)
    expect(await roleGuide('project-agent', '/nowhere')).toBeUndefined()
  })

  it('ships a separate guide for the Studio coordinator', async () => {
    const studio = await roleGuide('studio-agent')
    expect(studio).toBeDefined()
    expect(studio).not.toBe(await roleGuide('project-agent'))
    expect(studio).toContain('idealize post')
  })
})

describe('seedRolePreset', () => {
  const template = [
    '# header comment',
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    text: >-',
    '      generic persona',
    '',
    '# the tool row',
    '- id: tool',
    "  name: '@x/tool'",
    "  disabled: !!js process.platform === 'win32'",
    '',
  ].join('\n')

  it('replaces only the persona row and keeps loader-dialect tags verbatim', () => {
    const out = withRolePersona(template, 'project-agent')
    expect(out).toContain('Project Coordinator')
    expect(out).not.toContain('generic persona')
    expect(out).toContain("disabled: !!js process.platform === 'win32'")
    expect(out).toContain('# the tool row')
    expect(out.startsWith('# header comment\n- id: persona')).toBe(true)
  })

  it('writes the composition with the role persona and never overwrites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idealize-comm-presets-'))
    expect(await seedRolePreset(root, 'project-agent', 'project-agent', template)).toBe(true)
    const composition = await readFile(join(root, 'project-agent', 'agent.cordis.yml'), 'utf8')
    expect(composition).toContain('Project Coordinator')
    expect(composition).toContain('- id: tool')
    const meta = yaml.load(await readFile(join(root, 'project-agent', 'preset.yml'), 'utf8')) as { name: string }
    expect(meta.name).toBe('Project Coordinator')

    await writeFile(join(root, 'project-agent', 'agent.cordis.yml'), 'edited by the user\n')
    expect(await seedRolePreset(root, 'project-agent', 'project-agent', template)).toBe(false)
    expect(await readFile(join(root, 'project-agent', 'agent.cordis.yml'), 'utf8')).toBe('edited by the user\n')
  })

  it('adds a persona row when the template has none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'idealize-comm-presets-'))
    await mkdir(root, { recursive: true })
    expect(await seedRolePreset(root, 'project-agent', 'project-agent', "- id: tool\n  name: '@x/tool'\n")).toBe(true)
    const composition = await readFile(join(root, 'project-agent', 'agent.cordis.yml'), 'utf8')
    expect(composition.indexOf('- id: persona')).toBeLessThan(composition.indexOf('- id: tool'))
    expect(composition).toContain('Project Coordinator')
  })

  it('replaces a persona row that ends the composition', () => {
    const rewritten = withRolePersona('- id: system-prompt\n- id: persona\n  config:\n    text: the old one\n', 'project-agent')
    expect(rewritten).toContain('- id: system-prompt')
    expect(rewritten).not.toContain('the old one')
  })
})
