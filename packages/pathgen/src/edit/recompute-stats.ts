import type { PathDraft, PathStats } from '../schemas/path-draft'
import { flattenCoreLessons } from './locate'

/**
 * Rebuilds `pathStatsSchema` after a structural edit.
 *
 * `weeks_estimate` cannot be recomputed from first principles here — the pace
 * (`config.paceHoursPerWeek`) that produced it lives in the generation config, not in the
 * draft — so it is scaled by how much the total minutes changed instead of dropped. A draft
 * whose minutes have not moved keeps its exact previous estimate.
 */
export function recomputeStats(draft: PathDraft): PathStats {
  const lessons = flattenCoreLessons(draft)
  const conceptIds = new Set<string>()
  let minutes = 0

  for (const lesson of lessons) {
    for (const conceptId of lesson.concept_ids) conceptIds.add(conceptId)
    minutes += lesson.estimated_minutes
  }

  let checkpoints = 0
  for (const section of draft.sections) {
    for (const module of section.modules) {
      for (const conceptId of module.reinforcement.concept_ids) conceptIds.add(conceptId)
      minutes += module.reinforcement.estimated_minutes
      if (module.checkpoint !== null) {
        checkpoints += 1
        for (const conceptId of module.checkpoint.concept_ids) conceptIds.add(conceptId)
        minutes += module.checkpoint.estimated_minutes
      }
    }
  }

  const previous = draft.stats
  const weeksEstimate =
    previous.weeks_estimate === null || previous.minutes === 0
      ? previous.weeks_estimate
      : Math.max(1, Math.round(previous.weeks_estimate * (minutes / previous.minutes)))

  return {
    sections: draft.sections.length,
    modules: draft.sections.reduce((sum, section) => sum + section.modules.length, 0),
    lessons: lessons.length,
    checkpoints,
    concepts: conceptIds.size,
    minutes,
    weeks_estimate: weeksEstimate,
  }
}
