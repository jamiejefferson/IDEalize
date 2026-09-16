/**
 * What the app tells the paired chat without being asked: the Studio
 * coordinator's posts, task endings on project timelines, the Studio's
 * attention alerts and agent errors. Each kind has its own settings toggle.
 *
 * Task endings on the Studio's own timeline are not sent separately: the
 * Studio already posts those as messages there, which arrive as coordinator
 * posts. The bridge's `agent-finished` is not sent at all, because it fires
 * every time an agent goes idle, which is every turn.
 * @module @idealize/telegram/outbound
 */

import type { BridgeEvent } from '@idealize/host-bridge'
import { ENDING_WORDS, STUDIO_PROJECT, type StudioEvent } from '@idealize/studio'
import { alertText, errorText, studioPostText, taskEndingText } from './format.ts'
import { nameOf, type Messenger, type Services } from './ports.ts'
import type { TelegramSettings } from './settings.ts'
import type { Typing } from './typing.ts'

/** What the forwarder needs from its owner. */
export interface OutboundOptions {
  messenger: Messenger
  services: Services
  /** The phone's "typing…", stopped when the coordinator's reply goes out or its turn ends. */
  typing: Pick<Typing, 'stop'>
  /** The settings in force, read per event. */
  settings(): TelegramSettings
}

/** Forwards Studio events and bridge events to the paired chat. */
export class Outbound {
  constructor(private readonly options: OutboundOptions) {}

  /**
   * Forward one committed Studio event when a toggle asks for it.
   * @param event - the recorded event.
   */
  async onStudioEvent(event: StudioEvent): Promise<void> {
    const settings = this.options.settings()
    if (settings.chatId === '') return
    const body = (event.body ?? '').trim()
    if (event.project === STUDIO_PROJECT) {
      const addressedToOthers = event.target !== undefined && event.target !== 'user'
      if (!settings.forwardStudioReplies || event.kind !== 'message' || event.author === 'user' || addressedToOthers || body === '') return
      this.options.typing.stop()
      await this.options.messenger.send(studioPostText(await this.name(event.author), body))
      return
    }
    const words = event.kind === 'task-update' ? ENDING_WORDS[event.subtype ?? ''] : undefined
    if (!settings.forwardTaskEndings || words === undefined) return
    const state = await this.options.services.studio()?.state(event.project)
    const goal = state?.tasks.find(task => task.id === event.taskId)?.goal
    await this.options.messenger.send(taskEndingText(words, event.project, goal, body))
  }

  /**
   * Forward one bridge event when a toggle asks for it.
   * @param event - the bridge event.
   */
  async onBridgeEvent(event: BridgeEvent): Promise<void> {
    // The coordinator's turn ending, however it ends, ends "typing…" whether
    // or not its outcome is forwarded.
    if ((event.kind === 'agent-finished' || event.kind === 'agent-error')
      && event.sessionId !== undefined && await this.isStudioCoordinator(event.sessionId)) {
      this.options.typing.stop()
    }
    const settings = this.options.settings()
    if (settings.chatId === '' || !settings.forwardAttention) return
    if (event.kind === 'attention') {
      await this.options.messenger.send(alertText(event.title, event.body))
      return
    }
    if (event.kind === 'agent-error') {
      const name = event.sessionId === undefined ? undefined : await this.name(event.sessionId)
      await this.options.messenger.send(errorText(name, event.body))
    }
  }

  private async name(id: string): Promise<string> {
    return nameOf(await this.options.services.comm()?.roster() ?? [], id)
  }

  private async isStudioCoordinator(id: string): Promise<boolean> {
    const roster = await this.options.services.comm()?.roster() ?? []
    return roster.some(row => row.id === id && row.role === 'studio-agent')
  }
}
