import type { VersionDiffDto } from '@retenia/ipc-contract'
import { Badge } from '@retenia/ui'
import { useT } from '../../../i18n/use-t'

/**
 * "Regenerar ruta crea v2 con un diff" (`docs/spec/04-path-generation.md` §13 step 6): what the
 * regenerated version does to the one being studied, lesson by lesson. Lessons are paired by
 * the ideas they teach, so a lesson that only moved or was renamed reads "sin cambios" — and
 * keeps its progress when the new version is confirmed.
 */

export interface VersionDiffPanelProps {
  diff: VersionDiffDto
}

type Change = VersionDiffDto['lessons'][number]['change']

const VARIANT: Record<Change, 'neutral' | 'xp' | 'correct' | 'incorrect'> = {
  unchanged: 'neutral',
  changed: 'xp',
  added: 'correct',
  removed: 'incorrect',
}

export function VersionDiffPanel({ diff }: VersionDiffPanelProps) {
  const t = useT('path')
  const list = (ids: readonly string[]) => ids.map((id) => diff.conceptNames[id] ?? id).join(', ')

  return (
    <section
      className="border-border flex flex-col gap-3 rounded-md border p-4"
      data-testid="version-diff"
      aria-labelledby="version-diff-title"
    >
      <h2 id="version-diff-title" className="font-display text-lg font-semibold">
        {t('regenerate.diff.title', { from: diff.fromVersion })}
      </h2>
      <p className="text-muted text-sm" data-testid="version-diff-summary">
        {t('regenerate.diff.summary', diff.summary)}
      </p>
      <ul className="flex flex-col gap-2">
        {diff.lessons.map((lesson) => (
          <li
            key={`${lesson.change}-${lesson.specId ?? lesson.previousSpecId}`}
            className="flex flex-col gap-1"
            data-testid="version-diff-lesson"
            data-change={lesson.change}
          >
            <div className="flex items-center gap-2">
              <Badge variant={VARIANT[lesson.change]}>
                {t(`regenerate.diff.change.${lesson.change}`)}
              </Badge>
              <span className="text-sm font-medium">
                {lesson.title ?? lesson.previousTitle ?? lesson.previousSpecId}
              </span>
            </div>
            {lesson.change === 'changed' &&
              lesson.previousTitle !== null &&
              lesson.previousTitle !== lesson.title && (
                <span className="text-muted text-xs">
                  {t('regenerate.diff.was', { title: lesson.previousTitle })}
                </span>
              )}
            {lesson.change !== 'added' && lesson.addedConcepts.length > 0 && (
              <span className="text-xs">
                {t('regenerate.diff.addedConcepts', { concepts: list(lesson.addedConcepts) })}
              </span>
            )}
            {lesson.change !== 'removed' && lesson.removedConcepts.length > 0 && (
              <span className="text-xs">
                {t('regenerate.diff.removedConcepts', { concepts: list(lesson.removedConcepts) })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
