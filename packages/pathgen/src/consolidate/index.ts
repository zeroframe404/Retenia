export type {
  ChunkExtraction,
  ConsolidatedConcept,
  ConsolidationOptions,
  ConsolidationResult,
  ExtractedChunk,
} from './consolidate'
export {
  candidatePairs,
  conceptIdFor,
  consolidateConcepts,
  DEFAULT_BATCH_SIZE,
  DEFAULT_MAX_PAIRWISE,
  DEFAULT_THRESHOLD,
  MAX_ALIASES,
  MAX_PREREQUISITES,
} from './consolidate'
export { consolidatedImportance, FREQUENCY_BOOST, SOURCE_BONUS } from './importance'
export {
  blockingTokens,
  MIN_KEY_CHARS,
  MIN_TOKEN_CHARS,
  matchKey,
  normalizeTerm,
} from './normalize'
export { UnionFind } from './union-find'
export { dot } from './vector'
