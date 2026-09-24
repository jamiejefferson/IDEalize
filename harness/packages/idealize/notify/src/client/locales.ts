/** `idealize-notify` namespace dictionaries: the announcement banner and the chime row. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'banner.dismiss': '关闭',
  'banner.dismiss.help': '关闭——稍后可在公告中查看',
  'chime.title': '任务完成提示音',
  'chime.description': '代理完成任务时播放提示音，可选内置提示音或本机自带的提示音。',
  'chime.sound': '提示音',
  'chime.sound.builtIn': '内置提示音',
  'chime.volume': '音量',
  'chime.preview': '试听',
  'chime.notification.title': '代理已完成',
  'chime.notification.body': '有回复等待查看。',
  'chime.notification.failedTitle': '代理已停止',
  'chime.notification.failedBody': '本轮因错误结束，请打开对话查看。',
} as const

/** Translation key set. */
export type NotifyKey = keyof typeof zh

/** English dictionary. */
export const en: Record<NotifyKey, string> = {
  'banner.dismiss': 'Dismiss',
  'banner.dismiss.help': 'Dismiss. You can catch up later from the banner.',
  'chime.title': 'Task-complete chime',
  'chime.description': 'Plays a sound when the agent finishes a task. Pick the built-in chime or one of this computer\'s own alert sounds.',
  'chime.sound': 'Sound',
  'chime.sound.builtIn': 'Built-in chime',
  'chime.volume': 'Volume',
  'chime.preview': 'Preview',
  'chime.notification.title': 'Agent finished',
  'chime.notification.body': 'A reply is ready for you.',
  'chime.notification.failedTitle': 'Agent stopped',
  'chime.notification.failedBody': 'The turn ended on an error. Open the chat to see it.',
}
