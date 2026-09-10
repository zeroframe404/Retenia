import type { PathDraft } from '../schemas/path-draft'
import { splitLessonNode } from './split'

export interface DeepenResult {
  readonly draft: PathDraft
  /**
   * The extra expansion cost the added lessons project onto stage 7
   * (`docs/spec/04-path-generation.md` §3 stage 7) — `(parts - 1) * perLessonUsd`. Never a
   * charge that happened now: no AI call is made by a draft edit, only once expansion
   * (sub-phase 8.3) actually writes lesson theory.
   */
  readonly projectedCostDeltaUsd: number
}

/** "Profundizar" (`docs/spec/04-path-generation.md` §13 step 2): structurally identical to
 *  `splitLesson`, priced. `perLessonUsd` is the caller's current per-lesson rate — read from
 *  `generation_runs.estimate.p2Modules` — so this module stays pure and never resolves a rate
 *  table itself. */
export function deepenLesson(
  draft: PathDraft,
  lessonId: string,
  parts: 2 | 3,
  perLessonUsd: number,
): DeepenResult {
  const { draft: next } = splitLessonNode(draft, lessonId, parts)
  return { draft: next, projectedCostDeltaUsd: (parts - 1) * perLessonUsd }
}
