/**
 * The refusal contract this seam shares with its callers: every refusal
 * carries a tag a caller can switch on, so the Askbar can tell a capture too
 * short to be speech from a provider that is still fetching its model.
 * @module @idealize/transcribe/error
 */

/** Why a transcription was refused. */
export type TranscriptionRefusal =
  /** Nothing is registered, or the pinned id is not. */
  | 'no-provider'
  /** More than one provider is registered and the caller pinned none. */
  | 'ambiguous-provider'
  /** The provider cannot run yet; `detail` says what it is waiting on. */
  | 'not-ready'
  /** The capture is shorter than the configured floor: a slip, not speech. */
  | 'too-short'
  /** The capture is longer than the configured ceiling. */
  | 'too-long'
  /** The capture's sample rate is not the one the provider requires. */
  | 'sample-rate'
  /** The provider ran and failed. */
  | 'failed'

/** A refusal from the transcription seam. */
export class TranscriptionError extends Error {
  /** What was refused. */
  readonly refusal: TranscriptionRefusal

  /**
   * @param refusal - what was refused.
   * @param message - what a person reads.
   * @param options - standard error options; `cause` carries a provider failure.
   */
  constructor(refusal: TranscriptionRefusal, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TranscriptionError'
    this.refusal = refusal
  }
}
