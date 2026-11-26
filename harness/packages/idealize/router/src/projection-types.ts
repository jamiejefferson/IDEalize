/**
 * Types of the router's session events and their projection, kept free of
 * host imports so a client face can merge them.
 * @module @idealize/router/projection-types
 */

import type { StayReason } from './decide.ts'
import type { TaskType } from './tasks.ts'

/** A model as the badge names it. */
export interface RoutedModel { provider: string; model: string; label: string }

/** What one routed turn records. Stays with nothing to offer are logged to the file and not to the chat. */
export interface RouterEventData {
  /**
   * `switched`: the turn ran on `to`. `offer`: the router stayed and `to` is the user's to accept.
   * `reset`: the user took the model back, so an earlier switch no longer holds.
   * `declined`: the user turned the latest offer down; an earlier switch still holds.
   */
  outcome: 'switched' | 'offer' | 'reset' | 'declined'
  at: string
  from: RoutedModel
  to: RoutedModel
  /** Why an offer was not taken by the router itself. `ask`: the person set the router to ask before every move. */
  reason?: Extract<StayReason, 'needs-payment' | 'loses-context' | 'other-company'> | 'said-cannot' | 'ask' | undefined
  /** On an `ask` offer: `to` costs more per token than the model the chat is on. */
  dearer?: boolean | undefined
  task?: TaskType | undefined
  rationale?: string | undefined
  /** Gain in weighted score, 0 to 1. */
  improvement?: number | undefined
  /**
   * `dislike`: the person kept another model's answer, and the comparison card already says so.
   * `offer`: the person took the model offered.
   */
  via?: 'dislike' | 'offer' | undefined
}

/**
 * How the router behaves, app-wide. `auto`: it moves a chat when a better model fits.
 * `ask`: it offers the move and the person decides. `fixed`: it never moves a chat and never offers.
 */
export type RouterMode = 'auto' | 'ask' | 'fixed'

/** One model of the chat box chip's list. */
export interface RouterChoice extends RoutedModel {
  /** USD per million tokens, `free`, or null when no price is known. */
  price: { input: number; output: number } | 'free' | null
  /** Ticked: the router may move the chat to it. */
  allowed: boolean
  /** The model answering this chat now. */
  answering: boolean
}

/** What `GET /idealize/router/choices` answers. */
export interface RouterChoices {
  mode: RouterMode
  /** The Cheaper to Smarter slider, 0 to 100. */
  lean: number
  /** The company of the chat's own model. */
  company: string
  /** The model answering now: the routed one while a switch holds, else the chat's own. */
  answering: RoutedModel
  /** The company's connected models, cheapest first. */
  models: RouterChoice[]
  /** Every `provider/model` key the person unticked, at any company: the list a tick rewrites. */
  excluded: string[]
}

/** The kinds of model a comparison can ask (restated from ratings.ts, which reads files). */
export type CompareKind = 'chat' | 'image' | 'video' | 'audio'

/** One picture, clip or sound an alternative made. */
export interface CompareArtefact { id: string; mediaType: string }

/**
 * One step of a comparison after a dislike, all steps sharing an `id`.
 * `started`: the person accepted the offer, and the two models are at work.
 * `answer`: one alternative finished, or failed. `picked`: the person kept an
 * alternative, or their first answer (`picked: -1`).
 */
export interface RouterCompareEventData {
  id: string
  phase: 'started' | 'answer' | 'picked'
  at: string
  kind?: CompareKind | undefined
  /** The kind of work the answers are rated for. */
  tag?: string | undefined
  /** The model that gave the answer the person disliked. */
  first?: RoutedModel | undefined
  alternatives?: RoutedModel[] | undefined
  /** Chat: the log position of the disliked reply. */
  replySeq?: number | undefined
  /** Which alternative an `answer` or a `picked` names. */
  index?: number | undefined
  text?: string | undefined
  artefacts?: CompareArtefact[] | undefined
  /** Why the alternative gave no answer. */
  failed?: string | undefined
}

/**
 * A media model the router moved one generation to (`switched`), or the
 * alternative the person kept after a dislike (`kept`), which then serves the
 * rest of the chat's generations of that kind.
 */
export interface RouterMediaEventData {
  outcome: 'switched' | 'kept'
  at: string
  /** The media preset: `images`, `motion` or `sound`. */
  presetId: string
  from: RoutedModel
  to: RoutedModel
  tag?: string | undefined
  rationale?: string | undefined
}

/** A chat's lock: a locked chat is never routed. */
export interface RouterLockEventData { locked: boolean }

/** What clients read for the composer's badge. */
export interface RouterProjection {
  locked: boolean
  /** The latest switch or offer, absent once a reset or a declined offer follows it. */
  last?: RouterEventData | undefined
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One routed turn: a switch the router made, or one it left to the user.
     * Appended with the envelope's `ignorable` marker; a harness without the
     * router reads the log and runs the chat on the logged request headers.
     */
    'idealize/router': RouterEventData
    /** The chat's lock against routing. Latest wins. Ignorable for the same reason. */
    'idealize/router-lock': RouterLockEventData
    /** One step of a comparison after a dislike. Ignorable: the kept answer reaches the model as its own message. */
    'idealize/router-compare': RouterCompareEventData
    /** A media model the router chose, or the one the person kept. Ignorable: the artefacts record the model that served. */
    'idealize/router-media': RouterMediaEventData
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The chat's routing state, for the composer's badge and lock. */
    router: RouterProjection
  }
}
