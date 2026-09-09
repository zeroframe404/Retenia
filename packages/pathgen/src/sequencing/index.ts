export { buildCheckpoints, type CheckpointPlacement, checkpointSpans } from './checkpoints'
export { buildFinalExam } from './exam'
export {
  type Hierarchy,
  type OrderedModule,
  type OrderedSection,
  orderHierarchy,
} from './hierarchy'
export { assignIds, type Numbered, positional, prerequisitesOf, sourceRefsOf } from './ids'
export {
  keyOf,
  type LessonKey,
  type LessonRef,
  type Lifted,
  type LiftedEdge,
  liftGraph,
} from './lift'
export { lessonMinutes, weeksAvailable, weeksEstimate } from './minutes'
export { fitModuleSizes, type SizedLayout, type SizedModule } from './module-size'
export { buildReinforcement } from './reinforcement'
export {
  orderedSources,
  resolveSequencingLimits,
  type SequencingResult,
  sequencePath,
} from './sequence'
export type {
  CheckpointNode,
  CoreLessonNode,
  FinalExamBlueprint,
  FinalExamNode,
  ModuleNode,
  PathStats,
  ReinforcementNode,
  SectionNode,
  SequencedPath,
  SequencingConfig,
  SequencingLimits,
  SequencingOptions,
} from './types'
export { DEFAULT_SEQUENCING_LIMITS } from './types'
export { assignWarmups } from './warmup'
