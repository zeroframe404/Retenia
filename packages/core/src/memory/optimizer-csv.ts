import type { ReviewLog } from '../entities'
import { RATING } from './types'

/**
 * The review history in the `fsrs-optimizer` CSV format (§16: "export/import the history
 * in the `fsrs-optimizer` CSV").
 *
 * This is the optimizer's training input — `convertCsvToFsrsItems` in
 * `@open-spaced-repetition/binding` consumes exactly these five columns — and, because it
 * is the interchange format the FSRS ecosystem agreed on, it is also what lets a user take
 * their history to Anki's optimizer or to the public benchmark.
 *
 * Nothing here is Retenia-specific on purpose: no importance, no context, no exercise
 * score. A column the format does not define would break every other consumer.
 */

export const OPTIMIZER_CSV_HEADER = 'card_id,review_time,review_rating,review_state,review_duration'

export interface OptimizerCsvRow {
  cardId: string
  /** Unix milliseconds — what the format calls `review_time`. */
  reviewTime: number
  /** 1–4. Rating 0 never appears; see `toOptimizerCsvRows`. */
  reviewRating: number
  /** The `ts-fsrs` state *before* the review: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  reviewState: number
  /** Milliseconds the answer took; 0 when it was not recorded. */
  reviewDuration: number
}

/**
 * The rows of a training set, oldest first.
 *
 * Two exclusions, both required rather than tidiness:
 *
 * - **Rating 0 (`Manual`)** is a postpone or a forget, not evidence of recall. Feeding one
 *   in would teach the model that an interval ended in a grade the user never gave
 *   (`fsrs-rules`, and `reschedule.ts` drops them for the same reason).
 * - **Soft-deleted rows**, whose card has been deleted; `deleted_at` is the only mutation
 *   the append-only rule permits on a log.
 *
 * `scheduledDays` is deliberately *not* exported: the format derives elapsed time from
 * consecutive `review_time`s, and §8 keeps the real interval in the log precisely so an
 * exam's interval cap never reaches the optimizer.
 */
export function toOptimizerCsvRows(logs: readonly ReviewLog[]): OptimizerCsvRow[] {
  return logs
    .filter((log) => log.rating !== RATING.Manual && log.deletedAt === null)
    .map((log) => ({
      cardId: log.cardId,
      reviewTime: log.review.getTime(),
      reviewRating: log.rating,
      reviewState: log.state,
      reviewDuration: log.durationMs ?? 0,
    }))
    .sort((a, b) => a.reviewTime - b.reviewTime || (a.cardId < b.cardId ? -1 : 1))
}

/**
 * Render rows as CSV.
 *
 * No quoting: every column is a number except `card_id`, which is a UUIDv7 and so contains
 * neither a comma nor a quote. A row whose id somehow did would corrupt the file silently,
 * so it is rejected instead.
 */
export function formatOptimizerCsv(rows: readonly OptimizerCsvRow[]): string {
  const lines = [OPTIMIZER_CSV_HEADER]
  for (const row of rows) {
    if (/[",\r\n]/.test(row.cardId)) {
      throw new RangeError(`optimizer CSV: card id contains a separator: ${row.cardId}`)
    }
    lines.push(
      `${row.cardId},${row.reviewTime},${row.reviewRating},${row.reviewState},${row.reviewDuration}`,
    )
  }
  return `${lines.join('\n')}\n`
}

/** The whole export in one call — what the optimizer job is handed. */
export function toOptimizerCsv(logs: readonly ReviewLog[]): string {
  return formatOptimizerCsv(toOptimizerCsvRows(logs))
}

/** Read a file back, for round-trip tests and for importing a history from elsewhere. */
export function parseOptimizerCsv(csv: string): OptimizerCsvRow[] {
  const lines = csv.split('\n').filter((line) => line.trim().length > 0)
  const header = lines.shift()
  if (header?.trim() !== OPTIMIZER_CSV_HEADER) {
    throw new RangeError(`optimizer CSV: expected header "${OPTIMIZER_CSV_HEADER}"`)
  }
  return lines.map((line, index) => {
    const parts = line.split(',')
    if (parts.length !== 5) {
      throw new RangeError(`optimizer CSV: line ${index + 2} has ${parts.length} columns, want 5`)
    }
    const [cardId, reviewTime, reviewRating, reviewState, reviewDuration] = parts as [
      string,
      string,
      string,
      string,
      string,
    ]
    return {
      cardId,
      reviewTime: Number(reviewTime),
      reviewRating: Number(reviewRating),
      reviewState: Number(reviewState),
      reviewDuration: Number(reviewDuration),
    }
  })
}
