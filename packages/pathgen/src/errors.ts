/**
 * The one error type a generation run fails with, when it fails for a reason of its own
 * rather than the AI layer's (`AiError`) or the database's.
 */
export const GENERATION_ERROR_CODES = [
  /** A configured source id has no `sources` row. */
  'no_sources',
  /** Nothing in scope to read: every chunk is front matter or outside the selection. */
  'no_chunks',
  /** More than half of the attempted chunks failed extraction. */
  'too_many_chunk_failures',
  /** A module's lesson call failed after the AI layer's own repairs and fallbacks. */
  'module_failed',
  /** Nothing survived validation to sequence. */
  'outline_empty',
  'run_not_found',
  /** The run is already completed, failed or cancelled. */
  'run_not_resumable',
  'path_not_found',
  /** No `path_versions` row with that id (freeze/edit, sub-phase 8.2). */
  'version_not_found',
  /** `frozen_at` is already set: "frozen paths reject structural edits". */
  'already_frozen',
] as const

export type GenerationErrorCode = (typeof GENERATION_ERROR_CODES)[number]

export class GenerationError extends Error {
  override readonly name = 'GenerationError'
  readonly code: GenerationErrorCode

  constructor(code: GenerationErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export function isGenerationError(error: unknown): error is GenerationError {
  return error instanceof Error && error.name === 'GenerationError' && 'code' in error
}
