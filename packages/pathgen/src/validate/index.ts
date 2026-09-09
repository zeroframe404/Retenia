export { fillCoverageGaps } from './coverage'
export { clamp, compareEdges, type GraphValidation, validateGraph } from './graph'
export { type ConceptKey, compareConceptKey, conceptKey, primaryKeyOf } from './keys'
export {
  clampObjectives,
  dedupeObjectives,
  highestBloom,
  type LessonPosition,
  lessonLabel,
  normalizeLessons,
  resolveLimits,
  sortConceptIds,
  splitEvenly,
} from './lessons'
export type {
  ChunkIndex,
  ChunkRef,
  ConceptEdge,
  ConceptKind,
  ConceptNode,
  EdgeKind,
  KnowledgeGraph,
  LessonLimits,
  LessonOrigin,
  LessonSpec,
  Misconception,
  ModuleSpec,
  Objective,
  Outline,
  SectionSpec,
  SourceRef,
  ValidatedSynthesis,
  ValidationContext,
} from './types'
export {
  CONCEPT_KINDS,
  DEFAULT_IMPORTANCE_THRESHOLD,
  DEFAULT_LESSON_LIMITS,
  EDGE_KINDS,
} from './types'
export { validateSynthesis } from './validate'
