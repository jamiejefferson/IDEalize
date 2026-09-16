/** `idealize-notify` namespace dictionaries: the announcement banner and the chime row. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'banner.dismiss': '关闭',
  'banner.dismiss.help': '关闭——稍后可在公告中查看',
  'chime.title': '任务完成提示音',
  'chime.description': '代理完成任务时播放一声轻柔的提示音。',
  'chime.volume': '音量',
  'chime.preview': '试听',
  'chime.notification.title': '代理已完成',
  'chime.notification.body': '有回复等待查看。',
} as const

/** Translation key set. */
export type NotifyKey = keyof typeof zh

/** English dictionary. */
export const en: Record<NotifyKey, string> = {
  'banner.dismiss': 'Dismiss',
  'banner.dismiss.help': 'Dismiss. You can catch up later from the banner.',
  'chime.title': 'Task-complete chime',
  'chime.description': 'Plays a gentle shine when the agent finishes a task.',
  'chime.volume': 'Volume',
  'chime.preview': 'Preview',
  'chime.notification.title': 'Agent finished',
  'chime.notification.body': 'A reply is ready for you.',
}
