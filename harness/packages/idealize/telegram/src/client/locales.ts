/** `idealize-telegram` namespace dictionaries: the Settings row. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'telegram.title': 'Telegram 远程控制',
  'telegram.description': 'IDEalize 打开时，在手机上指挥工作室并处理审批。',
  'telegram.token.label': '机器人令牌',
  'telegram.token.placeholder': '粘贴 @BotFather 给你的令牌',
  'telegram.token.save': '连接',
  'telegram.token.remove': '移除令牌',
  'telegram.token.shadowed': '令牌由环境变量设置，无法在此更改。',
  'telegram.connected': '已连接到',
  'telegram.pair': '配对',
  'telegram.pair.send': '在 Telegram 中向机器人发送：',
  'telegram.pair.expires': '该代码几分钟后失效。',
  'telegram.paired': '已与你的 Telegram 聊天配对。',
  'telegram.unpair': '取消配对',
  'telegram.forward.forwardStudioReplies': '工作室协调员的回复',
  'telegram.forward.forwardTaskEndings': '任务结束',
  'telegram.forward.forwardAttention': '需要你关注的提醒和错误',
  'telegram.forward.forwardApprovals': '审批和问题',
} as const

/** Translation key set. */
export type TelegramKey = keyof typeof zh

/** English dictionary. */
export const en: Record<TelegramKey, string> = {
  'telegram.title': 'Telegram remote',
  'telegram.description': 'Direct the Studio and answer approvals from your phone while IDEalize is open.',
  'telegram.token.label': 'Bot token',
  'telegram.token.placeholder': 'Paste the token @BotFather gave you',
  'telegram.token.save': 'Connect',
  'telegram.token.remove': 'Remove token',
  'telegram.token.shadowed': 'The token is set by the environment, so it cannot be changed here.',
  'telegram.connected': 'Connected to',
  'telegram.pair': 'Pair',
  'telegram.pair.send': 'Send this to the bot in Telegram:',
  'telegram.pair.expires': 'The code stops working in a few minutes.',
  'telegram.paired': 'Paired with your Telegram chat.',
  'telegram.unpair': 'Unpair',
  'telegram.forward.forwardStudioReplies': 'Studio coordinator replies',
  'telegram.forward.forwardTaskEndings': 'Task endings',
  'telegram.forward.forwardAttention': 'Alerts that need you, and errors',
  'telegram.forward.forwardApprovals': 'Approvals and questions',
}
