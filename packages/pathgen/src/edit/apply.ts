import { pathDraftSchema } from '../schemas/path-draft'
import { deepenLesson } from './deepen'
import { excludeNode } from './exclude'
import { markKnown } from './mark-known'
import { mergeLessons } from './merge'
import { recomputeStats } from './recompute-stats'
import { renameNode } from './rename'
import { reorderNode } from './reorder'
import { setPrimarySource } from './set-primary-source'
import { splitLesson } from './split'
import type { PathEditOp, PathEditResult } from './types'

export interface ApplyEditOptions {
  /** The current per-lesson expansion rate, for `deepenLesson`'s cost projection — read from
   *  `generation_runs.estimate.p2Modules` by the caller. Defaults to `0` (no projection). */
  readonly perLessonUsd?: number
}

/**
 * The single entry point every `pathgen.editDraft` call goes through: dispatches to the pure
 * op, recomputes `stats`, and re-validates the result with `pathDraftSchema` before handing it
 * back — so nothing downstream of this function ever sees a structurally invalid draft, no
 * matter which op produced it.
 */
export function applyEdit(
  draft: PathEditResult['draft'],
  op: PathEditOp,
  options: ApplyEditOptions = {},
): PathEditResult {
  if (op.kind === 'replace') {
    return finish(pathDraftSchema.parse(op.draft))
  }
  if (op.kind === 'rename') {
    return finish(renameNode(draft, op.nodeId, op.title))
  }
  if (op.kind === 'reorder') {
    const { draft: next, breaksPrerequisite } = reorderNode(draft, op.nodeId, op.toIndex)
    return finish(next, breaksPrerequisite)
  }
  if (op.kind === 'exclude') {
    return finish(excludeNode(draft, op.nodeId))
  }
  if (op.kind === 'markKnown') {
    return finish(markKnown(draft, op.nodeId, true))
  }
  if (op.kind === 'unmarkKnown') {
    return finish(markKnown(draft, op.nodeId, false))
  }
  if (op.kind === 'mergeLessons') {
    return finish(mergeLessons(draft, op.lessonIds))
  }
  if (op.kind === 'splitLesson') {
    return finish(splitLesson(draft, op.lessonId, op.parts))
  }
  if (op.kind === 'deepenLesson') {
    const { draft: next, projectedCostDeltaUsd } = deepenLesson(
      draft,
      op.lessonId,
      op.parts,
      options.perLessonUsd ?? 0,
    )
    return finish(next, false, projectedCostDeltaUsd)
  }
  return finish(setPrimarySource(draft, op.sourceId))
}

function finish(
  draft: PathEditResult['draft'],
  breaksPrerequisite = false,
  projectedCostDeltaUsd?: number,
): PathEditResult {
  const withStats = { ...draft, stats: recomputeStats(draft) }
  const parsed = pathDraftSchema.parse(withStats)
  return {
    draft: parsed,
    warnings: [],
    breaksPrerequisite,
    ...(projectedCostDeltaUsd === undefined ? {} : { projectedCostDeltaUsd }),
  }
}
