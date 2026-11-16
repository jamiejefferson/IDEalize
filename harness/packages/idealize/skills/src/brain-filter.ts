/**
 * The brain's skill list as a registry view filter.
 *
 * A brain is an agent preset, and its `preset.yml` may carry `skills`: the
 * names of the skills it offers from the person's skills folder. The folder's
 * provider sits in the registry's global layer, which every chat reads, so the
 * list is applied where a chat reads the registry: a chat on a brain with a
 * list sees the listed folder skills and every skill from any other provider.
 * @module @idealize/skills/brain-filter
 */

import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { livePresetMounts, readPresetMetadata } from '@deepseek-ai/dsh-agent-presets'
import { scopeChainOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SkillViewFilter } from '@deepseek-ai/dsh-skill'

/**
 * The preset whose standing composition a viewing scope reads through: the
 * scope itself when it is a preset's standing key, else the nearest ancestor
 * that is one (an agent's key is parented to its preset's).
 * @param scope - the viewing scope of a registry read.
 * @returns the preset id, or `undefined` for a view outside every preset.
 */
export function presetOfScope(scope: ScopeKey | undefined): string | undefined {
  const chain = scopeChainOf(scope)
  return livePresetMounts().find(mount => mount.key !== undefined && chain.includes(mount.key))?.presetId
}

/**
 * The view filter that applies a brain's `skills` list to one provider's
 * skills. A view whose preset lists skills keeps that provider's skills only
 * when the list names them; skills from every other provider pass. A view
 * outside every preset, a preset the roster no longer holds, and a preset
 * whose metadata carries no list are not narrowed. The list is read from the
 * preset's `preset.yml` on every call, so an edit takes effect at the chat's
 * next request.
 * @param ctx - a context carrying the preset roster (`agentPresets`).
 * @param providerName - the provider whose skills the list selects from.
 * @returns the filter to register with `ctx.skills.registerFilter`.
 */
export function brainSkillFilter(ctx: Context, providerName: string): SkillViewFilter {
  /** Each preset's directory, kept after the first roster scan that finds it. */
  const directories = new Map<string, string>()
  const directoryOf = async (presetId: string): Promise<string | undefined> => {
    const known = directories.get(presetId)
    if (known !== undefined) return known
    const preset = (await ctx.agentPresets.list()).find(candidate => candidate.id === presetId)
    if (preset === undefined) return undefined
    const directory = dirname(preset.path)
    directories.set(presetId, directory)
    return directory
  }
  return async (skills, options) => {
    if (!skills.some(skill => skill.provider === providerName)) return skills
    const presetId = presetOfScope(options.scope)
    const directory = presetId === undefined ? undefined : await directoryOf(presetId)
    const offered = directory === undefined ? undefined : (await readPresetMetadata(directory)).skills
    return offered === undefined
      ? skills
      : skills.filter(skill => skill.provider !== providerName || offered.includes(skill.name))
  }
}
