/**
 * GenerationError: the shared failure contract every generation backend
 * translates provider failures into. Extends HarnessError like LlmError and
 * reuses its provider-neutral taxonomy (`AUTH`, `RATE_LIMIT`, `QUOTA`,
 * `INVALID_CREDENTIAL`, `MISSING_CREDENTIAL`, `NO_ADAPTER`), narrowed to a
 * closed union so consumers can switch exhaustively.
 * @module @idealize/generate/error
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Provider-neutral failure classes for generation. Closed union: route with `assertNever`-style switches. */
export type GenerationErrorCode =
  /** The credential was supplied but is unusable; fix the stored value. */
  | 'INVALID_CREDENTIAL'
  /** No credential resolves for the backend; store one. */
  | 'MISSING_CREDENTIAL'
  /** The provider refused the credential. */
  | 'AUTH'
  /** The provider asked to slow down; retrying later can succeed. */
  | 'RATE_LIMIT'
  /** Account quota, credits, or balance exhausted. */
  | 'QUOTA'
  /** The named backend is not registered. */
  | 'NO_ADAPTER'
  /** The named backend offers no such model. */
  | 'NO_MODEL'
  /** The model does not satisfy the request's required capabilities. */
  | 'INCOMPATIBLE_MODEL'
  /** The provider rejected the request as malformed. */
  | 'INVALID_REQUEST'
  /** The provider did not answer within the configured time. */
  | 'TIMEOUT'
  /** The caller's signal aborted the generation. */
  | 'ABORTED'
  /** Any other provider-side failure. */
  | 'PROVIDER_ERROR'

/** Serializable provider facts accepted beside the code. */
export interface GenerationErrorOptions extends ErrorOptions {
  /** HTTP status observed at the provider boundary. */
  status?: number
  /** Provider-requested retry delay in milliseconds. */
  retryAfterMs?: number
}

/**
 * Typed error for generation failures. The `code` narrows
 * {@link HarnessError.code} to {@link GenerationErrorCode}; route on it,
 * never by parsing `message`.
 */
export class GenerationError extends HarnessError {
  declare readonly code: GenerationErrorCode
  /** HTTP status observed at the provider boundary, when one exists. */
  readonly status?: number
  /** Provider-requested retry delay in milliseconds, when one was given. */
  readonly retryAfterMs?: number

  /**
   * @param message - non-empty human-readable failure summary.
   * @param code - the provider-neutral failure class.
   * @param options - optional cause and serializable provider facts.
   */
  constructor(message: string, code: GenerationErrorCode, options?: GenerationErrorOptions) {
    super(message, code, options)
    this.name = 'GenerationError'
    if (options?.status !== undefined) this.status = options.status
    if (options?.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs
  }
}

/**
 * Narrow an arbitrary thrown value to a GenerationError.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns true only for real instances.
 */
export function isGenerationError(value: unknown): value is GenerationError {
  return value instanceof GenerationError
}
