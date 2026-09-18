/**
 * `idealize-studio` namespace dictionaries: the coordination pane's header,
 * its load states and the one line under the owl on an empty Studio, the
 * synthesis card, the attention and task lists, the agents row, and the
 * timeline with each request's recorded resolution.
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'studio.title': '工作室',
  'studio.loading': '正在载入工作室…',
  'studio.error.cause': '原因：{cause}',
  'studio.retry': '重试',
  'studio.empty': '这里还没有内容。在下方给工作室协调员留言，或用 @名字 询问某个代理。',
  'studio.synthesis.title': '综述',
  'studio.synthesis.stale': '已过期',
  'studio.synthesis.none': '还没有发布综述。',
  'studio.synthesis.at': '· {at}',
  'studio.attention.title': '待处理',
  'studio.attention.none': '没有等待任何人的事项。',
  'studio.attention.for': '待处理：',
  'studio.tasks.title': '任务',
  'studio.tasks.none': '还没有任务。',
  'studio.agents.title': '代理',
  'studio.agents.queued': '{count} 项排队',
  'studio.agents.idle': '空闲',
  'studio.agents.finished': '已完成，可以关闭',
  'studio.timeline.title': '时间线',
  'studio.openThread': '打开会话',
  'studio.address': '在下方消息框中写给 {name}',
  'studio.author.unknown': '未知代理',
  'studio.request.open': '等待你的答复',
  'studio.request.answered': '已答复',
  'studio.presence.reachable': '在线',
  'studio.presence.unreachable': '离线',
  'studio.state.queued': '排队',
  'studio.state.working': '进行中',
  'studio.state.waiting': '等待',
  'studio.state.paused': '已暂停',
  'studio.state.done': '已完成',
  'studio.state.failed': '失败',
  'studio.state.cancelled': '已取消',
  'studio.attn.needs-input': '需要输入',
  'studio.attn.needs-action': '需要行动',
  'studio.attn.blocked': '受阻',
  'studio.attn.completion': '完成待确认',
  'studio.attn.failure': '失败待确认',
  'studio.attn.handoff-ready': '交接待接受',
  'studio.kind.message': '消息',
  'studio.kind.assignment': '指派',
  'studio.kind.task-update': '任务更新',
  'studio.kind.request': '请求',
  'studio.kind.decision': '决定',
  'studio.kind.handoff': '交接',
  'studio.kind.delivery': '递送',
  'studio.kind.synthesis': '综述',
  'studio.kind.system': '系统',
  'studio.agents.source': '代理',
}

/** One key of the `idealize-studio` dictionary. */
export type StudioKey = keyof typeof zh

/** English dictionary; keys mirror {@link zh} exactly. */
export const en: Record<StudioKey, string> = {
  'studio.title': 'Studio',
  'studio.loading': 'Loading Studio…',
  'studio.error.cause': 'Cause: {cause}',
  'studio.retry': 'Retry',
  'studio.empty': 'Nothing here yet. Message the Studio coordinator below, or @name to ask one agent.',
  'studio.synthesis.title': 'Synthesis',
  'studio.synthesis.stale': 'Out of date',
  'studio.synthesis.none': 'No synthesis published yet.',
  'studio.synthesis.at': '· {at}',
  'studio.attention.title': 'Needs attention',
  'studio.attention.none': 'Nothing waits on anyone.',
  'studio.attention.for': 'for',
  'studio.tasks.title': 'Tasks',
  'studio.tasks.none': 'No tasks yet.',
  'studio.agents.title': 'Agents',
  'studio.agents.queued': '{count} queued',
  'studio.agents.idle': 'Idle',
  'studio.agents.finished': 'Finished, safe to close',
  'studio.timeline.title': 'Timeline',
  'studio.openThread': 'Open chat',
  'studio.address': 'Write to {name} in the box below',
  'studio.author.unknown': 'Unknown agent',
  'studio.request.open': 'Waiting for you',
  'studio.request.answered': 'Answered',
  'studio.presence.reachable': 'Reachable',
  'studio.presence.unreachable': 'Unreachable',
  'studio.state.queued': 'Queued',
  'studio.state.working': 'Working',
  'studio.state.waiting': 'Waiting',
  'studio.state.paused': 'Paused',
  'studio.state.done': 'Done',
  'studio.state.failed': 'Failed',
  'studio.state.cancelled': 'Cancelled',
  'studio.attn.needs-input': 'Needs input',
  'studio.attn.needs-action': 'Needs action',
  'studio.attn.blocked': 'Blocked',
  'studio.attn.completion': 'Done — acknowledge',
  'studio.attn.failure': 'Failed — acknowledge',
  'studio.attn.handoff-ready': 'Handoff offered',
  'studio.kind.message': 'Message',
  'studio.kind.assignment': 'Assignment',
  'studio.kind.task-update': 'Task update',
  'studio.kind.request': 'Request',
  'studio.kind.decision': 'Decision',
  'studio.kind.handoff': 'Handoff',
  'studio.kind.delivery': 'Delivery',
  'studio.kind.synthesis': 'Synthesis',
  'studio.kind.system': 'System',
  'studio.agents.source': 'Agents',
}

/** The locale registry namespace this package owns. */
export const NS = 'idealize-studio'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Studio view's copy. */
    'idealize-studio': StudioKey
  }
}
