/** `idealize-activity` namespace dictionaries: the composer's brain switcher. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'confirm.continue': '继续',
  'confirm.cancel': '取消',
  'space.chat': '对话',
  'space.terminal': '终端',
  'space.gallery': '图片',
  'space.soundstage': '声音',
  'space.motion': '视频',
  'space.studio': '工作室',
  'brain.trigger': '当前大脑',
  'brain.heading': '可用于{space}的大脑',
  'brain.restarts': '将重启终端',
  'brain.noInstructions': '没有专属指令',
  'brain.addBrain': '为{space}添加大脑',
  'brain.confirmTitle': '切换到{brain}？',
  'brain.restartLine': '终端将重启，部分上下文可能会丢失。',
  'overflow.trigger': '更多设置',
  'overflow.access': '项目权限',
  'overflow.brain': '大脑',
} as const

/** Dictionary key set. */
export type ActivityKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ActivityKey, string> = {
  'confirm.continue': 'Continue',
  'confirm.cancel': 'Cancel',
  'space.chat': 'Chat',
  'space.terminal': 'Terminal',
  'space.gallery': 'Images',
  'space.soundstage': 'Sounds',
  'space.motion': 'Video',
  'space.studio': 'Studio',
  'brain.trigger': 'Brain',
  'brain.heading': 'Brains that work in {space}',
  'brain.restarts': 'restarts the shell',
  'brain.noInstructions': 'No instructions',
  'brain.addBrain': 'Add a brain for {space}',
  'brain.confirmTitle': 'Switch to {brain}?',
  'brain.restartLine': 'The terminal restarts. You may lose some context.',
  'overflow.trigger': 'More settings',
  'overflow.access': 'Project access',
  'overflow.brain': 'Brain',
}
