/**
 * The agent roles: which Activity Agent (preset) carries each, the seeding of
 * those presets into the user's preset root, and the role guide (a skill
 * shipped with this package) a chat on one receives. The lead-agent role was
 * retired (JJ, 1 Sep) in favour of the group chat on the Studio timeline.
 *
 * Two roles coordinate, at different altitudes. `project-agent` runs one
 * project folder and is found by that folder. `studio-agent` runs the Studio
 * itself: it takes every untagged Studio post and works through the project
 * coordinators, and it is found by the role alone because there is one.
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import type { CommRole } from './store.ts'

/** The settings-backed mapping from a preset id to each coordinator role. */
export interface RoleConfig {
  /** The preset id that carries the project-coordinator role. */
  projectAgentPreset: string
  /** The preset id that carries the Studio-coordinator role. */
  studioAgentPreset: string
}

/** The mapping in force when the settings section names no preset. */
export const DEFAULT_ROLE_CONFIG: RoleConfig = {
  projectAgentPreset: 'project-agent',
  studioAgentPreset: 'studio-agent',
}

/** The task label a role's chat carries instead of a brief-derived title. */
export const ROLE_TITLES: Readonly<Record<CommRole, string>> = {
  'project-agent': 'Project Coordinator',
  'studio-agent': 'Studio Coordinator',
}

/**
 * The role a preset id carries under the current mapping.
 * @param presetId - the session's preset id, undefined for a session with none.
 * @param config - the current preset→role mapping.
 * @returns the role, or undefined for an ordinary chat.
 */
export function roleOfPreset(presetId: string | undefined, config: RoleConfig): CommRole | undefined {
  if (presetId === undefined) return undefined
  if (presetId === config.studioAgentPreset) return 'studio-agent'
  return presetId === config.projectAgentPreset ? 'project-agent' : undefined
}

/** The opening turn a role chat starts on; a chat with no turn stays a hidden blank. */
export const ROLE_OPENING: Readonly<Record<CommRole, string>> = {
  'project-agent': 'Take up your role as this project\'s coordinator: run `idealize list`, `idealize board` and `idealize studio`, read your inbox and the group chat, then introduce yourself to the user in two lines.',
  'studio-agent': 'Take up your role as the Studio coordinator: run `idealize list` and `idealize studio` to see every project and who is coordinating each, read your inbox, then post two lines to the Studio saying what you can see.',
}

/**
 * The preset id that carries a role.
 * @param role - the role to look up.
 * @param config - the current preset→role mapping.
 * @returns the mapped preset id.
 */
export function presetOfRole(role: CommRole, config: RoleConfig): string {
  return role === 'studio-agent' ? config.studioAgentPreset : config.projectAgentPreset
}

const PERSONAS: Readonly<Record<CommRole, { name: string; description: string; persona: string }>> = {
  'project-agent': {
    name: 'Project Coordinator',
    description: 'Runs one project: coordinates the chats doing the work and gets every piece safely to live.',
    persona: 'You are the Project Coordinator for the project in {{cwd}}, powered by the {{model}} model. '
      + 'Other chats each do a piece of the work in this folder; you coordinate them and keep the user informed in plain language.',
  },
  'studio-agent': {
    name: 'Studio Coordinator',
    description: 'Runs the Studio: takes what the user says there, works through each project\'s coordinator, and answers in one voice.',
    persona: 'You are the Studio Coordinator, powered by the {{model}} model. The user talks to you in the Studio, '
      + 'which watches every project at once. You hold the picture across all of them, work through each project\'s '
      + 'coordinator rather than doing the work yourself, and answer in the Studio in plain language.',
  },
}

/**
 * The package's bundled skills directory (`skills/<role>/SKILL.md`, one level above both `src/` and `lib/`).
 * @returns the absolute directory path.
 */
export function skillsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

/**
 * The role guide's body, frontmatter stripped.
 * @param role - the role whose `SKILL.md` is read.
 * @param dir - the skills directory; defaults to the bundled one.
 * @returns the trimmed guide text, or undefined when the file is missing or unreadable.
 */
export async function roleGuide(role: CommRole, dir = skillsDir()): Promise<string | undefined> {
  const file = join(dir, role, 'SKILL.md')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
}

/** The persona row a role preset carries, as composition text. */
function personaRow(role: CommRole): string {
  const text = PERSONAS[role].persona
  return `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    text: >-\n      ${text}\n`
}

/**
 * Replace (or prepend) the persona row in a composition, textually: the
 * loader's YAML dialect carries `!!js` tags that a plain parser rejects, and
 * every other row must reach the new file byte-for-byte.
 * @param composition - the template composition text.
 * @param role - the role whose persona replaces the template's.
 * @returns the rewritten composition text.
 */
export function withRolePersona(composition: string, role: CommRole): string {
  const rowStart = /^- id: persona\s*$/m.exec(composition)
  if (rowStart === null) return `${personaRow(role)}\n${composition}`
  const after = composition.slice(rowStart.index + rowStart[0].length)
  const nextRow = /^(?:- |#|\S)/m.exec(after.replace(/^[^\n]*\n/, ''))
  const rowEnd = nextRow === null
    ? composition.length
    : rowStart.index + rowStart[0].length + after.indexOf('\n') + 1 + nextRow.index
  return `${composition.slice(0, rowStart.index)}${personaRow(role)}${composition.slice(rowEnd)}`
}

/**
 * Write a role preset next to the others, derived from a template
 * composition (the deployment's default preset) with the persona row replaced.
 * Existing presets are never overwritten: the user's edits to the
 * personalisation prompt are theirs.
 * @param root - the user preset root directory.
 * @param id - the preset id, which names its directory under `root`.
 * @param role - the role whose persona and metadata the preset carries.
 * @param templateComposition - the template composition text (the default preset's `agent.cordis.yml`).
 * @returns true when the preset was created; false when one already existed and was left alone.
 */
export async function seedRolePreset(root: string, id: string, role: CommRole, templateComposition: string): Promise<boolean> {
  const dir = join(root, id)
  try {
    await access(join(dir, 'agent.cordis.yml'))
    return false
  } catch {
    // Absent: create it below.
  }
  const details = PERSONAS[role]
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), `# ${details.name}: the persona row is the personalisation prompt; edit it freely.\n${withRolePersona(templateComposition, role)}`)
  await writeFile(join(dir, 'preset.yml'), yaml.dump({ name: details.name, description: details.description, order: 91 }))
  return true
}
