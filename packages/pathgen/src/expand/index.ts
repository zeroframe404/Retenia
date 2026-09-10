export type { ActivityAuthor, ActivityAuthorCall } from './activity-author'
export { type ResolvedTheory, resolveCitations } from './citations'
export {
  buildLessonContext,
  CITE_ID_PATTERN,
  type CitableFragment,
  contextKeyParts,
  type GlossaryTerm,
  LESSON_SOURCE_TOKEN_BUDGET,
  type LessonContext,
  type PreviousLesson,
} from './context'
export {
  DEFAULT_EXPAND_CONCURRENCY,
  type ExpandConcurrency,
  type ExpandDeps,
  type ExpandRepos,
  type RetrieveChunks,
} from './deps'
export {
  type ExpandProgress,
  type ExpandStageInput,
  type ExpandStageResult,
  type ExpandStageStatus,
  expandLessons,
  type LessonProgress,
  MAX_FAILED_LESSON_RATIO,
  RETRIEVAL_K,
  SYNCHRONOUS_HEAD_LESSONS,
  tooManyFailedLessons,
} from './expand-lessons'
export {
  emptyExpansion,
  LESSON_EXPANSION_VERSION,
  type LessonExpansion,
  lessonExpansionSchema,
  readExpansion,
} from './expansion'
export {
  BASE_FAMILIES,
  FAMILIES_BY_KIND,
  familiesFor,
  MAX_FAMILIES_PER_LESSON,
} from './families'
export {
  DUPLICATE_COSINE,
  dedupeByEmbedding,
  effectiveImportance,
  frontKey,
  frontOf,
  type MemoryItemDraft,
  MIN_FLASHCARDS_PER_LESSON,
  toMemoryItems,
} from './flashcards'
export {
  type ConceptFacts,
  chunkIndex,
  glossaryOf,
  importanceFloorOf,
  isExpanded,
  type LessonPlan,
  mappedChunkIds,
  planLessons,
  retrievalQuery,
} from './plan'
export { type ComposedPractice, composePractice, LESSON_PRACTICE_LIMITS } from './practice'
export {
  buildFlashcardRequest,
  buildTheoryRequest,
  expansionBinding,
  flashcardCustomId,
  MAKE_FLASHCARDS_STAGE,
  theoryCustomId,
  WRITE_LESSON_STAGE,
} from './requests'
