/** `idealize-tasks` namespace dictionary: the task column beside the tool rail. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'column.title': '任务',
  'column.progress': '{done}/{total}',
  'column.collapse': '收起任务',
  'column.expand': '展开任务',
  'column.empty': '这个对话还没有任务列表。',
} as const

/** English dictionary. */
export const en: Record<TasksKey, string> = {
  'column.title': 'Tasks',
  'column.progress': '{done}/{total}',
  'column.collapse': 'Collapse tasks',
  'column.expand': 'Expand tasks',
  'column.empty': 'No task list in this chat yet.',
}

/** Keys of this plugin's dictionary. */
export type TasksKey = keyof typeof zh

/** Dictionary namespace owned by this plugin. */
export const NS = 'idealize-tasks'

/** The copy face the task column reads. */
export type Translate = (key: TasksKey, params?: Record<string, unknown>) => string
