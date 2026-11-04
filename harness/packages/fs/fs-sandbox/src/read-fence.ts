/**
 * The in-process half of the confined read denial. A confined chat's shell is
 * refused by the kernel; its `read`, `read_image`, `edit`, `write`,
 * `str_replace_editor`, `grep` and `glob` tools run in the app, outside the
 * kernel sandbox, so this listener refuses them over the same rule list.
 *
 * The check runs on the path the filesystem seam resolves, so a symlink in the
 * project that points at a key is refused by where it lands. `grep` shells out
 * to ripgrep, which walks folders: a search that starts above a closed
 * location is refused unless every route to it crosses a hidden folder, which
 * `grep` skips. `glob` returns names only, so it is refused only inside a
 * closed location.
 *
 * Under full access, and on Windows, there are no rules and nothing is refused.
 *
 * @module @deepseek-ai/dsh-fs-sandbox/read-fence
 */

import { Context } from '@deepseek-ai/cordis'
import { READ_DENIED_REASON, isReadDenied, readDenialRules, searchReachesDenied } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'

/** The tools that take a path, and the argument that carries it. */
const PATH_ARGUMENT: Readonly<Record<string, string>> = {
  read: 'file_path',
  read_image: 'file_path',
  edit: 'file_path',
  write: 'file_path',
  str_replace_editor: 'path',
  grep: 'path',
  glob: 'path',
}

/** Words for a search that would walk through a closed folder. */
const SEARCH_REFUSED = 'A search from this folder would walk through the app\'s private data or the person\'s keychain, so it is closed to this chat. Search inside a project folder, or use the shell, which skips what it cannot read.'

/** The path a tool call names; a search with none starts in the session's folder. */
function requestedPath(exec: ToolExecution): string | undefined {
  const argument = PATH_ARGUMENT[exec.name]
  if (argument === undefined) return undefined
  const args = exec.arguments as Record<string, unknown> | null
  const path = args?.[argument]
  if (typeof path === 'string' && path.length > 0) return path
  return exec.name === 'grep' || exec.name === 'glob' ? '.' : undefined
}

/**
 * Register the read fence.
 * @param ctx - the provider's context, which holds `sandboxPolicy`.
 * @param fs - the provider, used to canonicalise paths the way the tools do.
 */
export function installReadFence(ctx: Context, fs: Pick<FileSystem, 'resolve'>): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<PreToolDecision>) => {
    const path = requestedPath(exec)
    if (path === undefined) return next()
    const rules = readDenialRules(ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session }))
    if (rules.length === 0) return next()
    const cwd = exec.agent?.session.header.cwd
    let target: FsTarget
    try {
      target = await fs.resolve(path, cwd === undefined ? {} : { cwd })
    } catch {
      // A path that cannot be resolved cannot be read; the tool reports it in its own words.
      return next()
    }
    if (isReadDenied(target.targetKey, rules)) return { kind: 'deny', reason: READ_DENIED_REASON }
    if (exec.name === 'grep' && searchReachesDenied(target.targetKey, rules)) return { kind: 'deny', reason: SEARCH_REFUSED }
    return next()
  })
}
