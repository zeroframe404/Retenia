export { type ApplyEditOptions, applyEdit } from './apply'
export { type DeepenResult, deepenLesson } from './deepen'
export { excludeNode } from './exclude'
export {
  flattenCoreLessons,
  getLesson,
  getModule,
  getSection,
  locateNode,
  moveWithinArray,
  type NodeLocation,
  withLessons,
  withModule,
  withSection,
} from './locate'
export { markKnown } from './mark-known'
export { mergeLessons } from './merge'
export { recomputeStats } from './recompute-stats'
export { renameNode } from './rename'
export { type ReorderResult, reorderNode } from './reorder'
export { retargetPrerequisite } from './retarget'
export { setPrimarySource } from './set-primary-source'
export { type SplitResult, splitLesson, splitLessonNode } from './split'
export {
  isPathEditError,
  PATH_EDIT_ERROR_CODES,
  PathEditError,
  type PathEditErrorCode,
  type PathEditOp,
  type PathEditResult,
} from './types'
