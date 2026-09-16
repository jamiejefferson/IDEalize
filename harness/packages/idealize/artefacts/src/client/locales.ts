/** `idealize-artefacts` namespace dictionaries: the media-folders settings row. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'folders.title': '生成的媒体保存位置',
  'folders.description': '每个项目内的文件夹。归档的文件移入各文件夹下的归档子文件夹。',
  'folders.images': '图片',
  'folders.sounds': '声音',
  'folders.video': '视频',
  'folders.archive': '归档子文件夹',
  'folders.invalid': '请使用项目内的相对路径，不含“..”',
} as const

/** Translation key set. */
export type ArtefactsKey = keyof typeof zh

/** English dictionary. */
export const en: Record<ArtefactsKey, string> = {
  'folders.title': 'Where generated media saves',
  'folders.description': 'Folders inside each project. Archived files move into the archive subfolder of their folder.',
  'folders.images': 'Images',
  'folders.sounds': 'Sounds',
  'folders.video': 'Video',
  'folders.archive': 'Archive subfolder',
  'folders.invalid': 'Use a path inside the project, without "..".',
}
