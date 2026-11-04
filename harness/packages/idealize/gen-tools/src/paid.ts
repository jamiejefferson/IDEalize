/**
 * The limits on what a generating chat can spend. A generation charges the
 * person's own provider account, and until 4 Nov 2026 nothing asked them first
 * or bounded a single call, so a chat that read hostile text could order a
 * thousand images in one line.
 *
 * Two parts. Hard caps on one call, which hold for everyone. And one question
 * per launch: the first paid generation nobody typed a request for waits for
 * the person's yes in that chat. Generation tools mount once per chat, so that
 * answer lives here at module level and is forgotten when the app restarts.
 * @module @idealize/gen-tools/paid
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { GenArtefact, GenCatalogEntry } from '@idealize/generate'

/**
 * The most items one call may ask for. The Images composer offers up to 4, and
 * 8 leaves room for someone asking in words for "eight options".
 */
export const MAX_COUNT = 8

/**
 * The longest output one call may ask for, in seconds. 60 s of video is several
 * times the composer's longest fallback option (10 s), and 300 s of audio
 * covers a full song.
 */
export const MAX_SECONDS: Readonly<Record<Exclude<GenArtefact, 'image'>, number>> = { video: 60, audio: 300 }

/**
 * Whether a person typing in this turn still gets asked. False costs the person
 * least: someone who types "make me a poster" in the Images space has already
 * said yes. Set this to true to ask before the first paid generation of a
 * launch whoever started it.
 */
export const ASK_WHEN_PERSON_TYPED: boolean = false

/** Input names a provider may read as "how many", across the adapters. */
const COUNT_INPUTS = ['n', 'num_images', 'num_outputs', 'batch_size', 'number_of_images', 'count']

/** Input names in seconds. `length` means frames on some video models, so it counts for audio alone. */
const SECOND_INPUTS = ['duration', 'seconds_total', 'duration_seconds', 'total_seconds']

/** Input names in milliseconds. */
const MILLISECOND_INPUTS = ['music_length_ms', 'duration_ms']

function numeric(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Refuse a call over the caps, before any money or network is involved.
 * @param toolName - the tool, for the message.
 * @param artefact - what it makes.
 * @param args - the tool's own count and duration, and the provider inputs passed through `options`.
 * @param args.count - the requested number of items.
 * @param args.duration_s - the requested duration in seconds.
 * @param args.options - provider inputs by their own names.
 * @throws when the call asks for more than a cap allows.
 */
export function assertWithinCaps(
  toolName: string,
  artefact: GenArtefact,
  args: { count?: number | undefined; duration_s?: number | undefined; options?: Record<string, unknown> | undefined },
): void {
  const options = args.options ?? {}
  const counts = [args.count, ...COUNT_INPUTS.map(input => numeric(options[input]))]
  const most = Math.max(0, ...counts.filter((value): value is number => value !== undefined))
  if (most > MAX_COUNT) {
    throw new Error(`${toolName} can make at most ${String(MAX_COUNT)} in one call, and this asked for ${String(most)}. `
      + 'Ask for fewer. If the person wants more, tell them why you stopped and let them decide.')
  }
  if (artefact === 'image') return
  const seconds = [
    args.duration_s,
    ...SECOND_INPUTS.map(input => numeric(options[input])),
    ...artefact === 'audio' ? [numeric(options.length)] : [],
    ...MILLISECOND_INPUTS.map((input) => {
      const value = numeric(options[input])
      return value === undefined ? undefined : value / 1000
    }),
  ]
  const longest = Math.max(0, ...seconds.filter((value): value is number => value !== undefined))
  if (longest > MAX_SECONDS[artefact]) {
    throw new Error(`${toolName} can make at most ${String(MAX_SECONDS[artefact])} seconds in one call, and this asked for ${String(longest)}. `
      + 'Ask for less. If the person wants more, tell them why you stopped and let them decide.')
  }
}

/** A model with a known price of zero costs nothing; a model with no published price may cost something. */
export function mayCharge(entry: GenCatalogEntry): boolean {
  return entry.model.price === undefined || entry.model.price.unitPrice > 0
}

/** What the person reads: the model, and its price when the provider publishes one. */
export function paidQuestion(entry: GenCatalogEntry): string {
  const price = entry.model.price
  const per = price === undefined
    ? 'and its provider publishes no price, so it may charge your account'
    : price.perOutput !== undefined
      ? `which costs about ${String(price.perOutput.amount)} ${price.currency} per ${price.perOutput.output} on your account`
      : `which costs ${String(price.unitPrice)} ${price.currency} per ${price.unit} on your account`
  return `This chat wants to generate with ${entry.model.name}, ${per}. Nobody typed this request here. `
    + 'If you allow it, IDEalize will not ask again until you next restart the app.'
}

/**
 * Whether the person typed in the turn this call belongs to. A note, a wake or
 * another chat's brief carries a different source, so it does not count.
 * @param session - the chat.
 * @returns true when a message of theirs opened or joined this turn.
 */
export function personTypedThisTurn(session: Pick<Session, 'events'>): boolean {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'turn/end') return false
    if (event?.type === 'user/message' && (event.data as { source?: { kind?: unknown } }).source?.kind === 'user') return true
  }
  return false
}

/** The slice of the approval service used here, read structurally: gen-tools composes without a dependency on it. */
export interface ApprovalFace {
  config?: { policy?: string | undefined }
  overrideOf?(session: Session): string | undefined
  request(request: {
    agent: { session: Session }
    toolName: string
    callId?: unknown
    reason?: string
    signal?: AbortSignal
  }): Promise<string>
}

let confirmed = false
let asking: Promise<string> | undefined

/** Forget this launch's answer, for tests. */
export function forgetPaidConfirmation(): void {
  confirmed = false
  asking = undefined
}

/**
 * Hold a paid generation until the person has said yes once in this launch.
 *
 * Calls already running share one question, so a burst raises one prompt. A
 * refusal is not remembered, so a later call asks again. A chat on Full access
 * has no prompt to show, because its approval policy answers every request with
 * no, so it runs without asking; the caps still hold there. A composition with
 * no approval service has nobody to ask, and every shipped profile carries one.
 * @param approval - the approval service, when composed.
 * @param request - the call that wants to generate.
 * @param request.agent - the chat making it.
 * @param request.toolName - the tool.
 * @param request.callId - the tool call.
 * @param request.signal - the call's abort signal.
 * @param entry - the model it will run on.
 * @throws when the person said no, or could not be asked.
 */
export async function confirmPaidGeneration(
  approval: ApprovalFace | undefined,
  request: { agent: { session: Session }; toolName: string; callId?: unknown; signal?: AbortSignal },
  entry: GenCatalogEntry,
): Promise<void> {
  if (confirmed || approval === undefined || !mayCharge(entry)) return
  const session = request.agent.session
  if (!ASK_WHEN_PERSON_TYPED && personTypedThisTurn(session)) return
  if ((approval.overrideOf?.(session) ?? approval.config?.policy ?? 'ask') === 'never') return
  const pending = asking ?? approval.request({ ...request, reason: paidQuestion(entry) })
  asking = pending
  let outcome: string
  try {
    outcome = await pending
  } finally {
    if (asking === pending) asking = undefined
  }
  if (outcome === 'allowed-once') {
    confirmed = true
    return
  }
  throw new Error(`${request.toolName}: the person did not allow this generation, which may charge their account. `
    + 'Nothing was generated. Tell them what you wanted to make and let them decide.')
}
