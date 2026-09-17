/**
 * Core knowledge for the command-line agent a fresh shell launches.
 *
 * A harness agent reads IDEalize's standing rules from its system prompt. The
 * CLIs a Terminal chat runs are other people's programs and read none of it,
 * so a Claude Code chat was never told where documentation goes (JJ,
 * 17 Sep 2026). The host gathers the same rules from the services that own
 * them, writes them to one file per shell, and passes that file to the launch
 * of a CLI that takes instructions on its command line — V0's project-agent
 * launch did the same with `--append-system-prompt`.
 *
 * {@link PROMPT_CHANNELS} lists the CLIs with such an option: Claude Code, Pi
 * and Codex, each proved on 17 Sep 2026 against the real program with a
 * control run that lacked the option. A CLI outside the table is typed as
 * configured.
 * @module @idealize/ui-terminal/knowledge
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What a service offers when it has standing rules for a terminal agent; probed, never injected. */
interface KnowledgeProviderLike {
  terminalKnowledge?: (cwd: string) => Promise<string | undefined> | string | undefined
}

/** The services asked for terminal knowledge, in the order their text appears. */
export const KNOWLEDGE_SERVICES = ['docPolicy'] as const

/** The line the knowledge file opens with, so the agent knows whose rules these are. */
export const KNOWLEDGE_PREAMBLE = 'Standing instructions from IDEalize, the app this terminal runs in. They hold for the whole session.'

/**
 * Gather the standing rules every composed provider has for a shell in `cwd`.
 * A provider that throws is skipped: a launch never fails over its guidance.
 * @param get - the context's service probe.
 * @param cwd - the shell's working directory.
 * @param warn - told which provider failed.
 * @returns the knowledge text, or `undefined` when no provider has any.
 */
export async function gatherKnowledge(
  get: (name: string) => unknown,
  cwd: string,
  warn: (message: string) => void = () => {},
): Promise<string | undefined> {
  const parts: string[] = []
  for (const name of KNOWLEDGE_SERVICES) {
    const provider = get(name) as KnowledgeProviderLike | undefined
    if (typeof provider?.terminalKnowledge !== 'function') continue
    try {
      const text = (await provider.terminalKnowledge(cwd))?.trim()
      if (text !== undefined && text !== '') parts.push(text)
    } catch (error) {
      warn(`idealize-ui-terminal: ${name} offered no terminal knowledge: ${String(error)}`)
    }
  }
  return parts.length === 0 ? undefined : [KNOWLEDGE_PREAMBLE, ...parts].join('\n\n')
}

/** How one CLI takes standing instructions on its command line. */
export interface PromptChannel {
  /** The option, up to where the quoted file read goes. */
  option: string
  /** Where the option is typed: Codex reads options before its subcommand or prompt, so its option follows the executable. */
  place: 'end' | 'after-executable'
  /** Matches a command that already sets its own instructions; such a command is the user's and is typed as written. */
  own: RegExp
}

/** The CLIs that take standing instructions at launch, keyed by executable name. */
export const PROMPT_CHANNELS: Readonly<Record<string, PromptChannel>> = {
  claude: { option: '--append-system-prompt ', place: 'end', own: /(^|\s)--(append-)?system-prompt(-file)?(\s|=|$)/ },
  pi: { option: '--append-system-prompt ', place: 'end', own: /(^|\s)--(append-)?system-prompt(\s|=|$)/ },
  codex: { option: '-c developer_instructions=', place: 'after-executable', own: /developer_instructions/ },
}

/**
 * The channel a launch command's CLI offers, judged by its executable's name.
 * @param command - the configured launch command.
 * @returns the channel, or `undefined` for another CLI or a command that sets its own instructions.
 */
export function promptChannel(command: string): PromptChannel | undefined {
  const executable = (command.trim().split(/\s+/)[0] ?? '').split('/').pop() ?? ''
  const channel = Object.hasOwn(PROMPT_CHANNELS, executable) ? PROMPT_CHANNELS[executable] : undefined
  return channel === undefined || channel.own.test(command) ? undefined : channel
}

/**
 * The command as typed: the configured launch plus the knowledge file, read by
 * the shell when the command runs. The path is single-quoted, so a space or a
 * quote in the harness home cannot break the line.
 * @param command - the configured launch command.
 * @param file - absolute path of the knowledge file.
 * @returns the command the shell types, or `undefined` when the CLI has no channel.
 */
export function withKnowledge(command: string, file: string): string | undefined {
  const channel = promptChannel(command)
  if (channel === undefined) return undefined
  const option = `${channel.option}"$(cat '${file.replaceAll('\'', '\'\\\'\'')}')"`
  const trimmed = command.trim()
  if (channel.place === 'end') return `${trimmed} ${option}`
  const [executable = '', ...rest] = trimmed.split(/\s+/)
  return [executable, option, ...rest].join(' ')
}

/**
 * Write one shell's knowledge file.
 * @param dir - the knowledge directory under the harness home.
 * @param terminalId - the shell's id; anything outside `[A-Za-z0-9._-]` becomes `_`.
 * @param text - the gathered knowledge.
 * @returns the file's absolute path.
 */
export async function writeKnowledgeFile(dir: string, terminalId: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${terminalId.replaceAll(/[^A-Za-z0-9._-]/g, '_')}.md`)
  await writeFile(file, `${text}\n`)
  return file
}
