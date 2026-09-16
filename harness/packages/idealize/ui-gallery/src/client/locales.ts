/** `idealize-gallery` namespace dictionaries: the Gallery view and the generation settings strip. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.gallery': '图片',
  'view.motion': '视频',
  'gallery.empty.image.title': '还没有生成图片',
  'gallery.empty.image.body': '描述你想要的画面，生成结果会收在这里。',
  'gallery.empty.video.title': '还没有生成视频',
  'gallery.empty.video.body': '描述你想要的镜头，生成结果会收在这里。',
  'gallery.empty.audio.title': '还没有生成声音',
  'gallery.empty.audio.body': '描述你想要的声音，生成结果会收在这里。',
  'gallery.status.running': '正在生成…',
  'gallery.status.thinking': '正在思考…',
  'gallery.status.failed': '生成失败',
  'gallery.turn.nothing': '这一轮没有生成任何内容。',
  'gallery.turn.stopped': '已停止。',
  'gallery.turn.failed': '这一轮失败了：{reason}',
  'gallery.retry': '重试',
  'gallery.retrying': '正在重新提交…',
  'gallery.retry.failed': '重新提交失败',
  'gallery.open': '打开原文件',
  'gallery.enlarge': '放大查看：{prompt}',
  'gallery.close': '关闭',
  'gallery.archive': '归档',
  'gallery.reveal': '显示文件',
  'gallery.keep': '保留',
  'gallery.archived.fold': '已归档（{count}）',
  'gallery.detail.type': '类型',
  'gallery.detail.size': '大小',
  'gallery.detail.aspect': '画幅',
  'gallery.detail.path': '文件',
  'gallery.settings.aspect': '画幅',
  'gallery.settings.count': '数量',
  'gallery.settings.duration': '时长',
  'gallery.settings.length': '长度',
  'gallery.settings.resolution': '分辨率',
  'gallery.settings.auto': '自动',
  'gallery.settings.unset': '–',
  'gallery.settings.seconds': '{seconds} 秒',
  'gallery.settings.secondsUnit': '秒',
  'gallery.settings.hint': '所选设置会附在消息末尾发送。',
} as const

/** English dictionary. */
export const en: Record<GalleryKey, string> = {
  'view.gallery': 'Images',
  'view.motion': 'Video',
  'gallery.empty.image.title': 'No images yet',
  'gallery.empty.image.body': 'Describe the picture you want and the results collect here.',
  'gallery.empty.video.title': 'No video yet',
  'gallery.empty.video.body': 'Describe the shot you want and the results collect here.',
  'gallery.empty.audio.title': 'No sounds yet',
  'gallery.empty.audio.body': 'Describe the sound you want and the results collect here.',
  'gallery.status.running': 'Generating…',
  'gallery.status.thinking': 'Thinking…',
  'gallery.status.failed': 'Generation failed',
  'gallery.turn.nothing': 'Nothing was generated this turn.',
  'gallery.turn.stopped': 'Stopped.',
  'gallery.turn.failed': 'This turn failed: {reason}',
  'gallery.retry': 'Retry',
  'gallery.retrying': 'Resubmitting…',
  'gallery.retry.failed': 'The retry could not be submitted',
  'gallery.open': 'Open the file',
  'gallery.enlarge': 'View full size: {prompt}',
  'gallery.close': 'Close',
  'gallery.archive': 'Archive',
  'gallery.reveal': 'Reveal',
  'gallery.keep': 'Keep',
  'gallery.archived.fold': 'Archived ({count})',
  'gallery.detail.type': 'Type',
  'gallery.detail.size': 'Size',
  'gallery.detail.aspect': 'Aspect',
  'gallery.detail.path': 'File',
  'gallery.settings.aspect': 'Aspect',
  'gallery.settings.count': 'Count',
  'gallery.settings.duration': 'Duration',
  'gallery.settings.length': 'Length',
  'gallery.settings.resolution': 'Resolution',
  'gallery.settings.auto': 'Auto',
  'gallery.settings.unset': '–',
  'gallery.settings.seconds': '{seconds} s',
  'gallery.settings.secondsUnit': 's',
  'gallery.settings.hint': 'Settings are added to the end of your message.',
}

/** Keys of this plugin's dictionary. */
export type GalleryKey = keyof typeof zh

/** Dictionary namespace owned by this plugin. */
export const NS = 'idealize-gallery'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Gallery's copy. */
    'idealize-gallery': GalleryKey
  }
}
