/**
 * Canonical vault scaffolding (DOC-05, one source): directories, the
 * CONVENTIONS/AGENTS texts, and the project-index template, all derived from
 * the packaged ruleset. Scaffolding is additive and idempotent — an existing
 * file is never overwritten, so adopting a live vault is safe. Moved here
 * from `@idealize/vault` so structure authority has exactly one home.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CANONICAL_DIRS,
  NOTE_OPTIONAL_FIELDS,
  PROJECT_INDEX_OPTIONAL_FIELDS,
  PROJECT_INDEX_REQUIRED_FIELDS,
  PROJECT_INDEX_TEMPLATE,
  RULESET_VERSION,
  STATUS_VOCABULARY,
} from './policy/ruleset.ts'

/**
 * The CONVENTIONS.md text written into a scaffolded vault and injected as
 * model-facing context. Assembled from the packaged ruleset constants so the
 * text can never disagree with what the scanner enforces.
 * @returns the conventions document.
 */
export function conventionsText(): string {
  return `# Vault conventions

Canonical IDEalize documentation ruleset ${RULESET_VERSION.id}.

- One project, one folder under Projects/, anchored by its \`_index.md\`. A project folder without an index is invisible to tooling.
- Folders: ${CANONICAL_DIRS.join(', ')}. Decisions/ holds cross-project decisions (\`YYYY-MM-DD-topic.md\`); Reference/ holds durable material not scoped to one project; People/ holds who's who.
- \`_index.md\` frontmatter carries ${PROJECT_INDEX_REQUIRED_FIELDS.map(field => `\`${field}\``).join(', ')} (plus optional ${PROJECT_INDEX_OPTIONAL_FIELDS.map(field => `\`${field}\``).join(', ')}). The \`repo:\` pointer (absolute path to the working checkout) is what lets tools verify a claim instead of believing it.
- In a project \`_index.md\`, \`status\` is one of ${STATUS_VOCABULARY.join(' | ')}, and it must be allowed to be wrong: a vault where everything says active carries no information. Other notes carry any \`status\`, and the writer chooses \`type\`; keep values you don't recognise.
- Optional on any note: ${NOTE_OPTIONAL_FIELDS.map(field => `\`${field}\``).join(', ')}. \`description\` is one sentence, shown in lists and search. IDEalize writes \`generated\`. Add a \`human:\` entry to \`verified\` only when the user confirms the note. Date-times carry a UTC offset.
- Decisions are append-only and dated (\`### YYYY-MM-DD — Title\`). Reverse a decision by appending a new entry that names the one it supersedes; never edit history.
- Dates are absolute ISO (YYYY-MM-DD), never "last week".
- The session log is \`log.md\` beside \`_index.md\`. IDEalize writes it when a session ends with commits; do not write it by hand.
- IDEalize writes \`last_touched\` on project notes that carry \`repo:\`, from commit evidence. On vault-only projects (no \`repo:\`), the session that did the work sets it at session close, and the weekly review may set it.
- Store what cannot be derived. Anything reconstructible from git, and any secret, stays out; record where a credential lives, never its value.
`
}

/**
 * The AGENTS.md text written into a scaffolded vault.
 * @returns the agents document.
 */
export function agentsText(): string {
  return `# Agents in this vault

- Read CONVENTIONS.md before writing.
- Projects/<name>/_index.md is each project's single source of truth for status and open threads; update it when work lands.
- IDEalize writes the session log, \`log.md\` beside each \`_index.md\`, from commit evidence. Leave it alone.
- IDEalize writes \`last_touched\` on project notes that carry \`repo:\`, from commit evidence. On vault-only projects (no \`repo:\`), the session that did the work sets it at session close, and the weekly review may set it.
- Decisions are append-only. Reference/ holds durable external material.
- A note is a claim, not a fact: verify against the repo before presenting it as current, and never invent an entry you did not observe.
`
}

/**
 * Instantiate the canonical project-index template for one repository.
 * @param name - project short name.
 * @param repo - absolute path to the working checkout.
 * @param date - ISO date stamped into `created`/`last_touched`.
 * @returns the filled `_index.md` content.
 */
export function projectNoteFor(name: string, repo: string, date: string): string {
  return PROJECT_INDEX_TEMPLATE
    .replace(/^project:.*$/m, `project: ${name}`)
    .replace(/^repo:.*$/m, `repo: ${repo}`)
    .replace(/^created:.*$/m, `created: ${date}`)
    .replace(/^last_touched:.*$/m, `last_touched: ${date}`)
    .replace(/^# .*$/m, `# ${name}`)
}

/**
 * Create the canonical vault structure; existing files and directories are kept.
 * @param folder - absolute path of the documentation folder.
 * @returns the names actually created (empty when the vault was complete).
 */
export async function scaffoldVault(folder: string): Promise<string[]> {
  const created: string[] = []
  for (const dir of CANONICAL_DIRS) {
    const path = join(folder, dir)
    if (!existsSync(path)) {
      await mkdir(path, { recursive: true })
      created.push(`${dir}/`)
    }
  }
  const files: [string, string][] = [
    ['CONVENTIONS.md', conventionsText()],
    ['AGENTS.md', agentsText()],
    [join('templates', 'project-index.md'), PROJECT_INDEX_TEMPLATE],
  ]
  for (const [name, content] of files) {
    const path = join(folder, name)
    if (!existsSync(path)) {
      await writeFile(path, content)
      created.push(name)
    }
  }
  return created
}
