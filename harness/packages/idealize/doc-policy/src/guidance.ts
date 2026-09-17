/**
 * The standing documentation guidance every agent's system prompt carries.
 *
 * The session-start notice reaches only a chat whose repository already has a
 * project note, so a chat anywhere else was never told the documentation
 * folder exists: it wrote plans and handoffs into the repository and no
 * project ever gained its first note (JJ, 17 Sep 2026). This section holds the
 * rule itself — where documentation goes, how the folder is laid out, how to
 * find a note — for every chat, with or without a note.
 */

import { join } from 'node:path'
import { CANONICAL_DIRS } from './policy/ruleset.ts'

/** Section name and band: the tool-guidance band, after `idealize:artefacts` (121). */
export const DOCUMENTATION_SECTION_NAME = 'idealize:documentation'
export const DOCUMENTATION_SECTION_ORDER = 122

/**
 * The guidance text for the folder in force.
 * @param folder - the configured documentation folder, or `undefined` before setup.
 * @returns the section text.
 */
export function documentationGuidance(folder: string | undefined): string {
  if (folder === undefined) {
    return 'No documentation folder is set, so project documentation has no home yet. '
      + 'When the work produces a plan, decision, research or handoff note, ask the user to choose their documentation folder in Settings before you write it.'
  }
  return `The user's documentation folder is ${folder}. Write every piece of project documentation there: status, plans, decisions, research, handoff and reference notes. `
    + 'A repository keeps only the files its code ships with (README, LICENSE, docs a build reads). '
    + `Layout: ${CANONICAL_DIRS.join('/, ')}/. Each project is Projects/<name>/ anchored by _index.md, which holds its status and open threads; the project's other notes sit beside it. `
    + 'Decisions/ holds cross-project decisions, Reference/ holds durable material, People/ holds who is who. '
    + 'Read CONVENTIONS.md at the folder root before your first write, and keep the project\'s _index.md current as work lands. '
    + 'Find an existing note with the docs_search tool before you ask the user or re-derive an answer.'
}

/**
 * The session-start notice for a repository the folder holds no note for.
 * @param folder - the configured documentation folder.
 * @param repoToplevel - the chat's repository toplevel.
 * @returns the notice text.
 */
export function missingNoteNotice(folder: string, repoToplevel: string): string {
  return `The documentation folder holds no project note for this repository (${repoToplevel}). `
    + `When the work produces anything worth recording, create ${join(folder, 'Projects', '<name>', '_index.md')} from ${join(folder, 'templates', 'project-index.md')} `
    + `and set its \`repo:\` field to ${repoToplevel}, the bare path with nothing after it. That pointer is how later chats in this repository are handed the note.`
}

/**
 * The standing guidance for a command-line agent in the built-in terminal
 * (Claude Code, say). It reads no harness prompt and has no `docs_search`, so
 * the text names the project's note outright and points at the shell's search.
 * @param folder - the configured documentation folder, or `undefined` before setup.
 * @param project - the shell's repository and the note found for it; omitted outside a repository.
 * @param project.repoToplevel - the repository toplevel.
 * @param project.notePath - the project note's path, or `undefined` when the folder holds none.
 * @returns the guidance text.
 */
export function terminalDocumentationGuidance(
  folder: string | undefined,
  project?: { repoToplevel: string; notePath: string | undefined },
): string {
  if (folder === undefined) return documentationGuidance(undefined)
  const rule = documentationGuidance(folder)
    .replace('Find an existing note with the docs_search tool', `Search ${folder} (rg or grep) for an existing note`)
  if (project === undefined) return rule
  return project.notePath === undefined
    ? `${rule}\n\n${missingNoteNotice(folder, project.repoToplevel)}`
    : `${rule}\n\nThis project's note is ${project.notePath}. Read it before you start and update it as work lands.`
}
