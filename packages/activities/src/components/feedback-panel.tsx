import { Button, cn } from '@retenia/ui'
import { CheckCircle2Icon, CircleAlertIcon, XCircleIcon } from 'lucide-react'
import { useActivity } from '../host/activity-context'
import { formatLabel } from '../labels'
import { RichText } from './rich-text'

/**
 * What the user sees once a `GradeResult` exists: the verdict, the grader's feedback, the model
 * answer, and the §9 "Explain" button that hands the activity, the answer and the static
 * explanation to the tutor.
 *
 * The panel only ever renders from a `GradeResult` — it takes no "assume correct" path — which is
 * the visible half of the machine's invariant that `feedback` is unreachable without one.
 *
 * It is `role="status"` with `aria-live="polite"`: a screen-reader user finds out the answer was
 * wrong without having to go looking for it, and — per `docs/spec/01-decisions.md` §7 rule 5 — the
 * wording never punishes the error.
 */

export type FeedbackTone = 'correct' | 'partial' | 'incorrect'

export function feedbackTone(score: number, correct: boolean): FeedbackTone {
  if (correct) return 'correct'
  return score > 0 ? 'partial' : 'incorrect'
}

const TONE_STYLES: Record<FeedbackTone, string> = {
  correct: 'border-correct/40 bg-correct/10',
  partial: 'border-streak/40 bg-streak/10',
  incorrect: 'border-incorrect/40 bg-incorrect/10',
}

const TONE_ICON_STYLES: Record<FeedbackTone, string> = {
  correct: 'text-correct',
  partial: 'text-streak',
  incorrect: 'text-incorrect',
}

const TONE_ICONS: Record<FeedbackTone, typeof CheckCircle2Icon> = {
  correct: CheckCircle2Icon,
  partial: CircleAlertIcon,
  incorrect: XCircleIcon,
}

export function FeedbackPanel() {
  const { result, labels, canRetry, retry, complete, explain, explanation, canExplain } =
    useActivity()
  if (result === null) return null

  const tone = feedbackTone(result.score, result.correct)
  const Icon = TONE_ICONS[tone]
  const verdict =
    tone === 'correct'
      ? labels.correct
      : tone === 'partial'
        ? labels.partiallyCorrect
        : labels.incorrect
  const explainable = canExplain || explanation.status !== 'idle'

  return (
    <section
      role="status"
      aria-live="polite"
      data-testid="feedback-panel"
      data-tone={tone}
      className={cn('text-text flex flex-col gap-3 rounded-lg border p-4', TONE_STYLES[tone])}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden className={cn('size-4', TONE_ICON_STYLES[tone])} />
        {verdict}
        <span className="text-muted ml-auto font-normal tabular-nums">
          {formatLabel(labels.scoreLabel, { score: Math.round(result.score * 100) })}
        </span>
      </h2>

      {result.feedback && <RichText className="text-sm">{result.feedback}</RichText>}

      {explanation.status === 'ready' && explanation.text && (
        <div data-testid="explanation">
          <h3 className="text-xs font-semibold uppercase tracking-wide">
            {labels.explanationHeading}
          </h3>
          <RichText className="text-sm">{explanation.text}</RichText>
        </div>
      )}
      {explanation.status === 'error' && (
        <p className="text-muted text-sm" data-testid="explanation-error">
          {labels.explainError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {canRetry && (
          <Button variant="secondary" onClick={retry} data-testid="retry-button">
            {labels.retry}
          </Button>
        )}
        <Button onClick={complete} data-testid="continue-button">
          {labels.continue}
        </Button>
        {explainable && (
          <Button
            variant="ghost"
            onClick={explain}
            disabled={explanation.status === 'loading'}
            data-testid="explain-button"
          >
            {explanation.status === 'loading' ? labels.explainLoading : labels.explain}
          </Button>
        )}
      </div>
    </section>
  )
}
