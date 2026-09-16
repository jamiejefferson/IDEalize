/**
 * Approvals and questions over Telegram. The relay reads the API proxy's mux
 * stream in-process, the same stream the app window reads, so it sees every
 * pending approval and question with the id that answers it. It sends each
 * one to the paired chat with buttons and answers through `respond`. The
 * first answer wins: when the window answers first, `respond` reports the
 * request as no longer pending and the relay says so on the phone; when the
 * phone answers first, the window receives the resolved frame and clears.
 *
 * Buttons carry a short id into this process's table, because Telegram caps
 * button data at 64 bytes. After a restart the table is empty, the old
 * buttons answer "no longer waiting", and the mux replay sends the requests
 * still pending as new messages.
 * @module @idealize/telegram/relay
 */

import { randomUUID } from 'node:crypto'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy'
import type { AskUserQuestionAnswerItem, AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import { ANSWER_TEXT, approvalOutcomeText, approvalText, questionKeyboard, questionText } from './format.ts'
import { abortableSleep, aborted, RestartableLoop } from './loop.ts'
import type { Messenger } from './ports.ts'

/** The API proxy calls the relay makes. */
export type ApiProxyPort = Pick<ApiProxy, 'events' | 'respond'>

/** What the relay needs from its owner. */
export interface RelayOptions {
  messenger: Messenger
  /** The API proxy; undefined when the composition lacks it. */
  api(): ApiProxyPort | undefined
  /** The name a person knows a session by. */
  nameOf(sessionId: string): Promise<string>
  /** Whether approvals and questions are forwarded; read when a request arrives. */
  enabled(): boolean
  /** Wait before reopening a mux stream that ended or failed. */
  reopenDelayMs: number
  onError(error: unknown): void
  /** Wait, resolving early when the signal aborts (tests replace it). */
  sleep?(ms: number, signal: AbortSignal): Promise<void>
}

interface ApprovalEntry {
  kind: 'approval'
  key: string
  rpcId: RpcId
  sessionId: string
  approvalId: string
  toolName: string
  name: string
  messageId: number
}

interface QuestionEntry {
  kind: 'question'
  key: string
  rpcId: RpcId
  sessionId: string
  questions: AskUserQuestionItem[]
  name: string
  messageId: number
  /** The question on screen. */
  index: number
  answers: AskUserQuestionAnswerItem[]
  /** Options ticked on a multi-select question. */
  selected: string[]
  /** The next text message answers the question on screen. */
  awaitingText: boolean
}

type Entry = ApprovalEntry | QuestionEntry

/** Forwards pending approvals and questions and settles them from button presses. */
export class Relay {
  private readonly entries = new Map<string, Entry>()
  private readonly byKey = new Map<string, string>()
  private counter = 0
  private readonly loop = new RestartableLoop(signal => this.run(signal))

  constructor(private readonly options: RelayOptions) {}

  /**
   * How many approvals and questions are on the phone waiting for an answer.
   * @returns the count of sent, unsettled requests.
   */
  pendingCount(): number {
    return this.entries.size
  }

  /** Open the mux stream, or reopen it so every still-pending request is offered again. */
  restart(): void {
    this.loop.restart()
  }

  /**
   * Close the mux stream.
   * @returns once the stream has unwound.
   */
  async stop(): Promise<void> {
    await this.loop.stop()
  }

  private async run(signal: AbortSignal): Promise<void> {
    const delay = this.options.reopenDelayMs
    while (!aborted(signal)) {
      const api = this.options.api()
      if (api === undefined) return
      try {
        for await (const envelope of api.events.mux({ rpcId: RpcId(`telegram-${randomUUID()}`), payload: {} }, signal)) {
          await this.handle(envelope)
        }
      } catch (error) {
        if (aborted(signal)) return
        this.options.onError(error)
      }
      if (aborted(signal)) return
      await (this.options.sleep?.(delay, signal) ?? abortableSleep(delay, signal))
    }
  }

  /**
   * Act on one mux frame. Frames other than the four approval and question
   * frames are ignored.
   * @param envelope - the frame with its server-request id.
   */
  async handle(envelope: RpcRequest<MuxFrame>): Promise<void> {
    try {
      await this.dispatch(envelope)
    } catch (error) {
      this.options.onError(error)
    }
  }

  private async dispatch({ rpcId, payload: frame }: RpcRequest<MuxFrame>): Promise<void> {
    switch (frame.type) {
      case 'approval/requested': {
        const key = `approval:${frame.approvalId}`
        if (this.byKey.has(key) || !this.options.enabled()) return
        const name = await this.options.nameOf(frame.sessionId)
        const short = this.claim(key)
        const messageId = await this.options.messenger.send(approvalText(name, frame.toolName, frame.reason), [[
          { text: ANSWER_TEXT.allow, data: `a:${short}:y` },
          { text: ANSWER_TEXT.deny, data: `a:${short}:n` },
        ]])
        if (messageId === undefined) {
          this.forget(short)
          return
        }
        this.entries.set(short, {
          kind: 'approval', key, rpcId, sessionId: frame.sessionId, approvalId: frame.approvalId,
          toolName: frame.toolName, name, messageId,
        })
        return
      }
      case 'approval/resolved': {
        const short = this.byKey.get(`approval:${frame.approvalId}`)
        const entry = short === undefined ? undefined : this.entries.get(short)
        if (entry?.kind !== 'approval') return
        this.forget(short as string)
        await this.options.messenger.edit(entry.messageId, approvalOutcomeText(entry.name, entry.toolName, frame.outcome))
        return
      }
      case 'question/requested': {
        const key = `question:${rpcId}`
        if (this.byKey.has(key) || !this.options.enabled() || frame.questions.length === 0) return
        const name = await this.options.nameOf(frame.sessionId)
        const short = this.claim(key)
        const first = frame.questions[0] as AskUserQuestionItem
        const messageId = await this.options.messenger.send(
          questionText(name, first, 0, frame.questions.length),
          questionKeyboard(short, first, []),
        )
        if (messageId === undefined) {
          this.forget(short)
          return
        }
        this.entries.set(short, {
          kind: 'question', key, rpcId, sessionId: frame.sessionId, questions: frame.questions, name, messageId,
          index: 0, answers: [], selected: [], awaitingText: (first.options ?? []).length === 0,
        })
        return
      }
      case 'question/resolved': {
        const short = this.byKey.get(`question:${frame.questionRpcId}`)
        const entry = short === undefined ? undefined : this.entries.get(short)
        if (entry?.kind !== 'question') return
        this.forget(short as string)
        await this.options.messenger.edit(entry.messageId, frame.outcome === 'answered' ? ANSWER_TEXT.answered : ANSWER_TEXT.cancelled)
        return
      }
      default:
        return
    }
  }

  /**
   * Act on a button press whose data belongs to the relay.
   * @param queryId - the callback query to acknowledge.
   * @param data - the button's data.
   * @returns false when the data is not an approval or question button.
   */
  async press(queryId: string, data: string): Promise<boolean> {
    const [prefix, short = '', action = ''] = data.split(':')
    if (prefix !== 'a' && prefix !== 'q') return false
    const entry = this.entries.get(short)
    if (entry === undefined || entry.kind !== (prefix === 'a' ? 'approval' : 'question')) {
      await this.options.messenger.answer(queryId, ANSWER_TEXT.gone)
      return true
    }
    if (entry.kind === 'approval') {
      await this.answerApproval(queryId, short, entry, action === 'y' ? 'allowed-once' : 'rejected')
      return true
    }
    await this.pressQuestion(queryId, short, entry, action)
    return true
  }

  /**
   * Hand a text message to the question waiting for typed input.
   * @param text - the message.
   * @returns false when no question is waiting for text.
   */
  async takeText(text: string): Promise<boolean> {
    const waiting = [...this.entries.entries()].reverse()
      .find((pair): pair is [string, QuestionEntry] => pair[1].kind === 'question' && pair[1].awaitingText)
    if (waiting === undefined) return false
    const [short, entry] = waiting
    const item = entry.questions[entry.index] as AskUserQuestionItem
    entry.answers.push({ id: item.id, selected: item.multiSelect === true ? [...entry.selected] : [], custom: text })
    await this.advance(short, entry)
    return true
  }

  private async answerApproval(queryId: string, short: string, entry: ApprovalEntry, outcome: 'allowed-once' | 'rejected'): Promise<void> {
    const receipt = await this.settle(entry.rpcId, { sessionId: entry.sessionId, approvalId: entry.approvalId, outcome })
    if (receipt) {
      // The resolved frame that follows edits the message.
      await this.options.messenger.answer(queryId, outcome === 'allowed-once' ? ANSWER_TEXT.allowed : ANSWER_TEXT.denied)
      return
    }
    this.forget(short)
    await this.options.messenger.answer(queryId, ANSWER_TEXT.already)
    await this.options.messenger.edit(entry.messageId, ANSWER_TEXT.already)
  }

  private async pressQuestion(queryId: string, short: string, entry: QuestionEntry, action: string): Promise<void> {
    const item = entry.questions[entry.index] as AskUserQuestionItem
    if (action === 'other') {
      entry.awaitingText = true
      await this.options.messenger.answer(queryId, ANSWER_TEXT.typeIt)
      return
    }
    if (action === 'done') {
      entry.answers.push({ id: item.id, selected: [...entry.selected] })
      await this.options.messenger.answer(queryId)
      await this.advance(short, entry)
      return
    }
    const label = (item.options ?? [])[Number(action)]?.label
    if (label === undefined) {
      await this.options.messenger.answer(queryId, ANSWER_TEXT.gone)
      return
    }
    await this.options.messenger.answer(queryId)
    if (item.multiSelect === true) {
      entry.selected = entry.selected.includes(label)
        ? entry.selected.filter(existing => existing !== label)
        : [...entry.selected, label]
      await this.options.messenger.edit(
        entry.messageId,
        questionText(entry.name, item, entry.index, entry.questions.length),
        questionKeyboard(short, item, entry.selected),
      )
      return
    }
    entry.answers.push({ id: item.id, selected: [label] })
    await this.advance(short, entry)
  }

  /** Show the next question, or send the answers once every question has one. */
  private async advance(short: string, entry: QuestionEntry): Promise<void> {
    entry.index += 1
    entry.selected = []
    const next = entry.questions[entry.index]
    if (next !== undefined) {
      entry.awaitingText = (next.options ?? []).length === 0
      await this.options.messenger.edit(
        entry.messageId,
        questionText(entry.name, next, entry.index, entry.questions.length),
        questionKeyboard(short, next, []),
      )
      return
    }
    entry.awaitingText = false
    const accepted = await this.settle(entry.rpcId, { sessionId: entry.sessionId, answer: { answers: entry.answers } })
    if (accepted) return
    this.forget(short)
    await this.options.messenger.edit(entry.messageId, ANSWER_TEXT.already)
  }

  private async settle(rpcId: RpcId, value: unknown): Promise<boolean> {
    const api = this.options.api()
    if (api === undefined) return false
    const receipt = await api.respond({ type: 'client-response', rpcId, result: { ok: true, value } })
    return receipt.accepted
  }

  private claim(key: string): string {
    this.counter += 1
    const short = this.counter.toString(36)
    this.byKey.set(key, short)
    return short
  }

  private forget(short: string): void {
    this.entries.delete(short)
    for (const [key, value] of this.byKey) {
      if (value === short) this.byKey.delete(key)
    }
  }
}
