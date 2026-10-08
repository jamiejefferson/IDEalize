// The status tag names the surface, and spoken project names match loosely.
import { describe, expect, it } from 'vitest'
import { mergeProjects, resolveProject } from '../src/projects.ts'
import { appOfTool, statusOfTool } from '../src/status.ts'
import { powellContext } from '../src/guide.ts'

describe('status tag', () => {
  it('names connected apps from their tool names', () => {
    expect(appOfTool('mcp__paper__write_html')).toBe('Paper')
    expect(appOfTool('mcp__plugin_paper-desktop_paper__get_guide')).toBe('Paper')
    expect(appOfTool('mcp__plugin_hatch_hatch__navigate')).toBe('Hatch')
    expect(appOfTool('mcp__claude_ai_Notion__search')).toBe('Notion')
    expect(appOfTool('bash')).toBeUndefined()
    expect(statusOfTool('mcp__hatch__navigate', '{}', undefined)).toBe('Working in Hatch')
  })

  it('describes workspace tools in plain words', () => {
    expect(statusOfTool('grep', '{}', 'Idealize')).toBe('Searching Idealize')
    expect(statusOfTool('docs_search', '{}', undefined)).toBe('Searching the docs')
    expect(statusOfTool('bash', '{"command":"idealize spawn --path /x \\"brief\\""}', undefined)).toBe('Handing it to an agent')
  })
})

describe('projects', () => {
  const projects = mergeProjects(
    ['/code/IDEalize'],
    ['/work/IDEalize', '/work/JACQ', '/work/Hatch', '/work/_archive', '/work/Hatch Site'],
    ['/vault/Projects/IDEalize', '/vault/Projects/Fable'],
  )

  it('merges sources by name and skips private folders', () => {
    expect(projects.map(project => project.name)).toEqual(['Fable', 'Hatch', 'Hatch Site', 'IDEalize', 'JACQ'])
    expect(projects.find(project => project.name === 'IDEalize')).toEqual({ name: 'IDEalize', path: '/code/IDEalize', notes: '/vault/Projects/IDEalize' })
  })

  it('matches what speech recognition writes', () => {
    expect(resolveProject(projects, 'idea lize').match?.name).toBe('IDEalize')
    expect(resolveProject(projects, 'idea lies').match?.name).toBe('IDEalize')
    expect(resolveProject(projects, 'jack').match?.name).toBe('JACQ')
    expect(resolveProject(projects, 'jacq').match?.name).toBe('JACQ')
    expect(resolveProject(projects, 'hatch').match?.name).toBe('Hatch')
    expect(resolveProject(projects, 'hat').match).toBeUndefined()
    expect(resolveProject(projects, 'hat').candidates.map(project => project.name)).toEqual(['Hatch', 'Hatch Site'])
    expect(resolveProject(projects, 'nothing').candidates).toEqual([])
  })

  it('tells the model the active project and the apps it can reach', () => {
    const peek = (folder: string): string[] => folder === '/work/JACQ' ? ['src/', 'package.json'] : ['_index.md', 'plan.md']
    const text = powellContext({ name: 'JACQ', path: '/work/JACQ', notes: '/vault/Projects/JACQ' }, { documentationFolder: '/vault' }, ['Hatch', 'Paper'], peek)
    expect(text).toContain('Active project: JACQ.')
    // The working folder and the notes folder, each with what it holds, so
    // Powell never calls a full folder empty or misses the project's docs.
    expect(text).toContain('Working folder: /work/JACQ')
    expect(text).toContain('Holds: src/, package.json')
    expect(text).toContain('Notes folder (its documentation): /vault/Projects/JACQ')
    expect(text).toContain('Holds: _index.md, plan.md')
    expect(text).toContain('Connected apps: Hatch, Paper.')
    expect(powellContext(undefined, {}, [])).toContain('Which project?')
  })
})
