/** `idealize-soundstage` namespace dictionaries: the Sound Stage view. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.soundstage': '声音',
  'stage.empty.title': '这个对话还没有声音。',
  'stage.empty.body': '在下面描述你想要的声音，生成结果会出现在这里。',
  'row.generating': '正在生成…',
  'row.thinking': '正在思考…',
  'row.nothing': '这一轮没有生成任何内容。',
  'row.turnFailed': '这一轮失败了：{reason}',
  'row.stopped': '已停止。',
  'row.failed': '生成失败',
  'row.retry': '重试',
  'row.untitled': '未命名的声音',
  'row.play': '播放',
  'row.keep': '保留',
  'row.archive': '归档',
  'row.reveal': '显示文件',
  'stage.archived.fold': '已归档 {count} 个',
} as const

/** English dictionary. */
export const en: Record<SoundstageKey, string> = {
  'view.soundstage': 'Sounds',
  'stage.empty.title': 'No sounds in this chat yet.',
  'stage.empty.body': 'Describe the sound you want below, and each result appears here.',
  'row.generating': 'Generating…',
  'row.thinking': 'Thinking…',
  'row.nothing': 'Nothing was generated this turn.',
  'row.turnFailed': 'This turn failed: {reason}',
  'row.stopped': 'Stopped.',
  'row.failed': 'Generation failed',
  'row.retry': 'Retry',
  'row.untitled': 'Untitled sound',
  'row.play': 'Play',
  'row.keep': 'Keep',
  'row.archive': 'Archive',
  'row.reveal': 'Reveal',
  'stage.archived.fold': '{count} archived',
}

/** Keys of this plugin's dictionary. */
export type SoundstageKey = keyof typeof zh

/** Dictionary namespace owned by this plugin. */
export const NS = 'idealize-soundstage'

/** The copy face the Sound Stage components read. */
export type Translate = (key: SoundstageKey, params?: Record<string, unknown>) => string
