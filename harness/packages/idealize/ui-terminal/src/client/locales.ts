/** `idealize-terminal` namespace dictionaries: the terminal view. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.terminal': '终端',
  'terminal.connecting': '正在打开终端…',
  'terminal.exited': '终端已退出。',
  'terminal.restart': '再开一个',
  'terminal.error': '无法打开终端',
  'terminal.noPrompts': '无权限提示运行',
  'terminal.noPrompts.detail': '此聊天中的智能体编辑文件、运行命令前不会征求同意。',
} as const

/** English dictionary. */
export const en: Record<TerminalKey, string> = {
  'view.terminal': 'Terminal',
  'terminal.connecting': 'Opening the terminal…',
  'terminal.exited': 'The shell has ended.',
  'terminal.restart': 'Open another',
  'terminal.error': 'The terminal could not open',
  'terminal.noPrompts': 'Runs without permission prompts',
  'terminal.noPrompts.detail': 'The agent in this chat edits files and runs commands without asking first.',
}

/** Keys of this plugin's dictionary. */
export type TerminalKey = keyof typeof zh

/** Dictionary namespace owned by this plugin. */
export const NS = 'idealize-terminal'
