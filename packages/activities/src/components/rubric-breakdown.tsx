import type { AiGradeDetail } from '@retenia/activity-schema'
import { cn } from '@retenia/ui'
import { useActivity } from '../host/activity-context'
import { formatLabel } from '../labels'

/**
 * The rubric half of an AI grade (`docs/spec/03-activities.md` §10's **AI** row,
 * `docs/spec/04-path-generation.md` §12): a score per criterion with the anchor the grader
 * picked, and the quotes it took **from the learner's own answer**.
 *
 * It exists because a percentage is not feedback. §12 asks the judge for "a score per criterion,
 * evidence cited from the answer, and 2–3 lines of feedback" precisely so the learner can see
 * *which* part of what they wrote earned what — and, when the grade is wrong, has something
 * concrete to disagree with before overriding the rating.
 *
 * Renders nothing when the grade carries no rubric: a `free_recall` graded on key points alone
 * has a coverage list instead, which the renderer shows next to the model answer.
 */

function percent(score: number): string {
  return `${Math.round(score * 100)}%`
}

export interface RubricBreakdownProps {
  detail: AiGradeDetail
}

export function RubricBreakdown({ detail }: RubricBreakdownProps) {
  const { labels } = useActivity()
  const { perCriterion } = detail
  // De-duplicated by criterion and quote: a grader that cited the same sentence twice for the
  // same criterion has said one thing, and showing it twice would only look like two. It also
  // makes the pair a stable React key, which an index would not be.
  const evidence = [
    ...new Map(
      detail.evidence.map((entry) => [`${entry.criterionId ?? ''}:${entry.quote}`, entry]),
    ).values(),
  ]
  if (perCriterion.length === 0 && evidence.length === 0) return null

  return (
    <div className="flex flex-col gap-3" data-testid="rubric-breakdown">
      {perCriterion.length > 0 && (
        <section>
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.rubricHeading}
          </h3>
          <ul className="mt-1 flex flex-col gap-2">
            {perCriterion.map((criterion) => (
              <li
                key={criterion.id}
                data-testid={`criterion-${criterion.id}`}
                data-score={criterion.score}
                className="flex flex-col gap-0.5"
              >
                <p className="flex items-baseline gap-2 text-sm">
                  <span className="font-medium">{criterion.criterion}</span>
                  {criterion.weight !== 1 && (
                    <span className="text-muted text-xs">
                      {formatLabel(labels.criterionWeight, { weight: criterion.weight })}
                    </span>
                  )}
                  <span
                    className={cn(
                      'ml-auto text-sm tabular-nums',
                      criterion.score >= 0.8 ? 'text-correct' : 'text-muted',
                    )}
                  >
                    {percent(criterion.score)}
                  </span>
                </p>
                {criterion.level !== undefined && (
                  <p className="text-muted text-xs">{criterion.level}</p>
                )}
                {criterion.comment !== undefined && <p className="text-xs">{criterion.comment}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {evidence.length > 0 && (
        <section data-testid="answer-evidence">
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.evidenceHeading}
          </h3>
          <ul className="mt-1 flex flex-col gap-1">
            {evidence.map((entry) => (
              <li
                key={`${entry.criterionId ?? ''}:${entry.quote}`}
                className="border-border text-muted border-l-2 pl-2 text-sm italic"
              >
                {entry.quote}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
