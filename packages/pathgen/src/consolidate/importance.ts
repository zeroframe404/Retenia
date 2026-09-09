/**
 * The importance of a consolidated concept: "max(importance) × frequency boost" from the
 * sub-phase brief, made concrete.
 *
 * A concept the extractor rated 0.6 in one chunk and that turns up in ten chunks is more
 * central than its best single rating says; one that also appears in a second source is more
 * central still. The boost is logarithmic so that a term repeated on every page of a chapter
 * does not swamp a definition stated once, and everything is capped at 1.
 *
 * | chunks | boost |
 * |---|---|
 * | 1 | ×1.00 |
 * | 2 | ×1.10 |
 * | 5 | ×1.24 |
 * | 10 | ×1.35 |
 * | 50 | ×1.59 |
 */
export const FREQUENCY_BOOST = 0.15
/** A flat bonus per additional source the concept appears in. */
export const SOURCE_BONUS = 0.05

export function consolidatedImportance(
  maxImportance: number,
  distinctChunks: number,
  distinctSources: number,
): number {
  const frequency = 1 + FREQUENCY_BOOST * Math.log(Math.max(1, distinctChunks))
  const sources = SOURCE_BONUS * Math.max(0, distinctSources - 1)
  return Math.min(1, Math.max(0, maxImportance) * frequency + sources)
}
