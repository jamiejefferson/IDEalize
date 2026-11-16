/* jscpd:ignore-start */
/**
 * Package-owned invariant companion for `@idealize/skills`.
 * @module @idealize/skills/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@idealize/skills'

/** Cordis companion plugin name. */
export const name = 'idealize-skills-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin mounts filesystem skill providers over the
 * staged skills folder, a project's playbooks and its own shipped skills,
 * registers one registry view filter, and appends learnings through one tool.
 * Which skills those folders hold is the providers' own discovery, the
 * settings value is validated at its schema, and the append-only rule of a
 * learnings file is a property of each write that no event stream reports.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
