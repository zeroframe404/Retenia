import type { LessonSummaryDto } from '@retenia/ipc-contract'
import type { BadgeProps } from '@retenia/ui'
import { Badge, Button, EmptyState, QaBadges } from '@retenia/ui'
import { useEffect } from 'react'
import { useT } from '../../i18n/use-t'
import { useExpand, useLessons, useRegenerateLesson } from './use-pathgen'

/**
 * Stage 7's panel — `docs/spec/04-path-generation.md` §13 step 5: *"lessons appear
 * progressively; the first is ready in < 1 min; each lesson with 'Regenerate', 'More
 * examples', 'Report an error' (opens the citation)"*.
 *
 * It lives on the completion screen because that is the screen that exists after "Confirmar
 * ruta". The path map is sub-phase 9.1 and will reuse `pathgen.getLessons` and
 * `pathgen.lessonStatus` unchanged; nothing here has to be thrown away for it.
 *
 * Read-only about the *content*: rendering a lesson's theory is 9.2's lesson player, and a
 * panel that tried would be a second renderer to keep in step with it.
 */

// `qa` — written, not yet through §5's gates (sub-phase 8.4) — is a lesson the learner can
// already open: its theory, practice and cards are on the row; the badges land with the verdict.
const STATUS_VARIANT: Record<LessonSummaryDto['status'], NonNullable<BadgeProps['variant']>> = {
  pending: 'neutral',
  generating: 'brand',
  qa: 'brand',
  ready: 'correct',
  failed: 'incorrect',
}

export interface ExpansionPanelProps {
  pathVersionId: string
  /** Where "Reportar error" sends the learner. */
  onOpenSource?: (input: {
    sourceId: string
    locator: string
    page: number | null
    blockIds: readonly string[]
  }) => void
}

export function ExpansionPanel({ pathVersionId, onOpenSource }: ExpansionPanelProps) {
  const t = useT('path')
  const lessons = useLessons(pathVersionId)
  const expand = useExpand(pathVersionId)
  const regenerate = useRegenerateLesson(pathVersionId)

  const rows = lessons.data?.lessons ?? []
  const pending = rows.filter((lesson) => lesson.status === 'pending').length

  // A frozen path arrives with every lesson `pending`, so the panel starts the expansion the
  // first time it is looked at rather than waiting for a button nobody would know to press.
  // `pathgen.expand` is idempotent, which is what makes an effect an honest place to do it.
  useEffect(() => {
    if (lessons.isLoading || pending === 0 || expand.isPending || expand.isSuccess) return
    expand.mutate({ pathVersionId })
  }, [expand, lessons.isLoading, pathVersionId, pending])

  if (lessons.isLoading) return null
  if (rows.length === 0) return <EmptyState title={t('expansion.empty')} />

  return (
    <section className="flex flex-col gap-3" data-testid="pathgen-expansion">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{t('expansion.title')}</h2>
        <p className="text-muted text-sm">
          {expand.isPending || pending > 0 ? t('expansion.expanding') : t('expansion.subtitle')}
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {rows.map((lesson) => (
          <li
            key={lesson.id}
            className="border-border flex flex-col gap-1 rounded-lg border p-3"
            data-testid={`pathgen-lesson-${lesson.specId}`}
          >
            <div className="flex items-center gap-3">
              <Badge variant={STATUS_VARIANT[lesson.status]}>
                {t(`expansion.status.${lesson.status}`)}
              </Badge>
              <span className="text-muted text-xs">{lesson.specId}</span>
              <span className="grow truncate font-medium">{lesson.title}</span>
              <span className="text-muted text-xs">
                {t('expansion.counts', {
                  activities: lesson.activities,
                  flashcards: lesson.flashcards,
                })}
              </span>
              {lesson.qa !== null && (
                <QaBadges
                  faithfulness={lesson.qa.faithfulness}
                  sourcesCount={lesson.qa.sourcesCount}
                  verdict={lesson.qa.verdict}
                  reviewed={lesson.qa.reviewed}
                  labels={{
                    fidelity: (percent) => t('qa.fidelity', { percent }),
                    sources: (count) => t('qa.sources', { count }),
                    reviewed: t('qa.reviewed'),
                    review: t('qa.review'),
                    unreviewed: t('qa.unreviewed'),
                  }}
                />
              )}
            </div>

            {lesson.unmet.length > 0 && (
              <p className="text-muted text-xs">
                {t('expansion.unmet', {
                  rules: lesson.unmet.map((rule) => rule.rule).join(', '),
                })}
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={regenerate.isPending}
                onClick={() => regenerate.mutate({ lessonId: lesson.id, mode: 'regenerate' })}
              >
                {t('expansion.regenerate')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                // A lesson under review already has its practice block: more examples are
                // welcome while the gates read the theory.
                disabled={
                  regenerate.isPending || (lesson.status !== 'ready' && lesson.status !== 'qa')
                }
                onClick={() => regenerate.mutate({ lessonId: lesson.id, mode: 'more_examples' })}
              >
                {t('expansion.moreExamples')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={lesson.firstCitation === null}
                title={
                  lesson.firstCitation === null ? t('expansion.reportErrorDisabled') : undefined
                }
                onClick={() => {
                  if (lesson.firstCitation === null) return
                  onOpenSource?.({
                    sourceId: lesson.firstCitation.sourceId,
                    locator: lesson.firstCitation.locator,
                    page: lesson.firstCitation.page,
                    blockIds: lesson.firstCitation.blockIds,
                  })
                }}
              >
                {t('expansion.reportError')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
