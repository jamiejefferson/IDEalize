/**
 * A project's playbooks as skills.
 *
 * A project's folder inside the documentation folder may hold `playbooks/`:
 * skills written for that project (`playbooks/<name>/SKILL.md`, or a flat
 * `playbooks/<name>.md`). This provider lists them for a chat whose working
 * directory belongs to the project, and for no other chat: the lookup is keyed
 * by the chat's working directory, the way the filesystem provider's project
 * roots are.
 * @module @idealize/skills/playbooks
 */

import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillProviderControl, SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'

/** The provider name playbooks register under. */
export const PLAYBOOKS_PROVIDER_NAME = 'idealize-playbooks'

/** The folder inside a project's documentation folder that holds its playbooks. */
export const PLAYBOOKS_FOLDER = 'playbooks'

/** The `source` every playbook carries. */
export const PLAYBOOK_SOURCE = 'project-playbooks'

/**
 * The rank every playbook carries: between the filesystem provider's project
 * roots (100, 200) and its custom roots (300), so a playbook wins a name over
 * a skill from the person's skills folder in the same registry layer.
 */
export const PLAYBOOK_RANK = 150

/**
 * The project a working directory belongs to: the nearest folder at or above
 * it that holds a `.git` entry, the rule the filesystem provider's project
 * roots follow.
 * @param cwd - an absolute working directory.
 * @returns the project's folder, or `cwd` itself outside every repository.
 */
export async function projectRootOf(cwd: string): Promise<string> {
  for (let current = cwd; ;) {
    if (await stat(join(current, '.git')).then(() => true, () => false)) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/**
 * Lists the playbooks of the project a lookup's working directory belongs to.
 * It keeps one filesystem provider per playbooks folder it has been asked
 * about, each watching that folder (present or not yet created) and
 * invalidating this registration when it changes.
 */
export class PlaybooksProvider implements SkillProvider {
  readonly name = PLAYBOOKS_PROVIDER_NAME
  /** One filesystem provider per playbooks folder, keyed by the folder's path. */
  private readonly folders = new Map<string, FileSystemSkillProvider>()
  /** Loads a listed playbook's body; it scans and watches nothing. */
  private readonly loader: FileSystemSkillProvider

  /**
   * @param ctx - the context the wrapped filesystem providers read and log through.
   * @param control - this registration's lifecycle and invalidation control.
   * @param playbooksFolder - the playbooks folder for a working directory, or `undefined` when the
   *   directory belongs to no documented project.
   */
  constructor(
    private readonly ctx: Context,
    private readonly control: SkillProviderControl,
    private readonly playbooksFolder: (cwd: string) => Promise<string | undefined>,
  ) {
    this.loader = this.providerOver([])
  }

  /**
   * The playbooks for the lookup's working directory.
   * @param options - lookup options; `cwd` selects the project, `signal` cancels discovery.
   * @returns the project's playbooks, or none without a working directory or a documented project.
   */
  async list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    const folder = options.cwd === undefined ? undefined : await this.playbooksFolder(options.cwd)
    if (folder === undefined) return []
    let provider = this.folders.get(folder)
    if (provider === undefined) {
      provider = this.providerOver([folder])
      this.folders.set(folder, provider)
    }
    const listed = await provider.list({ signal: options.signal })
    const playbook = (candidate: SkillCandidate): SkillCandidate => ({ ...candidate, source: PLAYBOOK_SOURCE, rank: PLAYBOOK_RANK })
    /* v8 ignore next 3 -- the filesystem provider answers with an incomplete
       observation only when a host watcher fails to start, which its own suite
       pins; this passes that answer on with the same candidates. */
    if (!Array.isArray(listed)) return { candidates: listed.candidates.map(playbook), complete: listed.complete }
    return listed.map(playbook)
  }

  /**
   * Load one listed playbook's body.
   * @param candidate - a candidate this provider listed.
   * @param options - lookup options whose signal cancels the read.
   * @returns the playbook, or `undefined` when its file has gone.
   */
  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    return await this.loader.get(candidate, options)
  }

  /**
   * Close every folder watcher.
   * @returns a promise that settles when every wrapped provider has closed its watchers.
   */
  async dispose(): Promise<void> {
    await Promise.all([this.loader, ...this.folders.values()].map(provider => provider.dispose()))
  }

  private providerOver(folders: string[]): FileSystemSkillProvider {
    return new FileSystemSkillProvider(this.ctx, this.control, {
      providerName: this.name,
      includeDefaultRoots: false,
      customSkillDirs: folders,
      watch: folders.length > 0,
    })
  }
}
