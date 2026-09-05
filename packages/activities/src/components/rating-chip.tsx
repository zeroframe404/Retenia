import { GRADES, type Grade } from '@retenia/core'
import { Button, cn, Input } from '@retenia/ui'
import { useId, useState } from 'react'
import { useActivity } from '../host/activity-context'
import { formatLabel } from '../labels'

/**
 * The rating chip of §3's M-ai row: *"the rubric returns a rating and the user can correct it"*.
 *
 * Two states, and they are the same control:
 *
 * - The grader rated the answer → the chip shows what the answer will be **scheduled** as, with
 *   a "Change" button. §7 rule 2 of `docs/spec/01-decisions.md` makes the scheduler transparent
 *   ("the user sees … why something appears today"), and this is the moment where the number
 *   that decides the next interval is set. Hiding it would leave the learner disagreeing with an
 *   interval a week later, when nothing can be done about it.
 * - The grader declined (`uncertain`, §12 of `docs/spec/04-path-generation.md`) → there is no
 *   rating, nothing is written to `review_logs`, and the panel asks the learner to rate it
 *   themselves. That press is not an *override*: it is the only rating there has ever been.
 *
 * Either way the correction lands in `result.meta.ratingOverride` with the reason the learner
 * gave, which is what §17 risk 3 needs in order to re-tune the thresholds later.
 */

const TONE: Record<Grade, string> = {
  1: 'border-incorrect/50 text-incorrect',
  2: 'border-streak/50 text-streak',
  3: 'border-correct/50 text-correct',
  4: 'border-correct/50 text-correct',
}

export function RatingChip() {
  const { result, labels, overrideRating, canOverrideRating } = useActivity()
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [picked, setPicked] = useState<Grade | null>(null)
  const reasonId = useId()

  if (result === null) return null
  const uncertain = result.meta.uncertain === true
  const override = result.meta.ratingOverride
  // `uncertain` keeps the picker open: there is no rating yet, so there is nothing to "change".
  const open = editing || (uncertain && result.rating === null)

  function commit(rating: Grade) {
    overrideRating(rating, reason)
    setEditing(false)
    setReason('')
    setPicked(null)
  }

  return (
    <section
      data-testid="rating-chip"
      data-rating={result.rating ?? 'none'}
      data-uncertain={uncertain}
      className="border-border flex flex-col gap-2 rounded-md border p-3"
    >
      {uncertain && result.rating === null ? (
        <div>
          <h3 className="text-sm font-semibold">{labels.uncertainHeading}</h3>
          <p className="text-muted text-xs" data-testid="uncertain-notice">
            {labels.uncertainNotice}
          </p>
        </div>
      ) : (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.scheduledAs}
          </span>
          {result.rating !== null && (
            <span
              data-testid="rating-value"
              className={cn('rounded-full border px-2 py-0.5 text-xs', TONE[result.rating])}
            >
              {labels.selfGrade[result.rating]}
            </span>
          )}
          {!open && canOverrideRating && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditing(true)
                setPicked(result.rating)
              }}
              data-testid="change-rating-button"
            >
              {labels.changeRating}
            </Button>
          )}
        </p>
      )}

      {override !== undefined && !open && (
        <p className="text-muted text-xs" data-testid="rating-overridden">
          {formatLabel(labels.ratingOverridden, {
            from:
              override.from === null ? labels.uncertainHeading : labels.selfGrade[override.from],
          })}
          {override.reason !== undefined && ` — ${override.reason}`}
        </p>
      )}

      {open && (
        <fieldset className="flex flex-col gap-2" data-testid="rating-override">
          <legend className="sr-only">{labels.selfGradeHeading}</legend>
          <div className="flex flex-wrap gap-2">
            {GRADES.map((rating) => (
              <Button
                key={rating}
                variant={picked === rating ? 'primary' : 'outline'}
                aria-pressed={picked === rating}
                onClick={() => setPicked(rating)}
                data-testid={`override-grade-${rating}`}
              >
                {labels.selfGrade[rating]}
              </Button>
            ))}
          </div>
          <div className="flex flex-col gap-1 text-xs">
            <label className="text-muted" htmlFor={reasonId}>
              {labels.overrideReasonLabel}
            </label>
            <Input
              id={reasonId}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="override-reason"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={picked === null}
              onClick={() => {
                if (picked !== null) commit(picked)
              }}
              data-testid="override-save"
            >
              {labels.overrideSave}
            </Button>
            {/* An `uncertain` grade has no rating to fall back to, so there is nothing to
                cancel back to: the picker is the only way this answer gets scheduled. */}
            {!uncertain && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  setPicked(null)
                }}
                data-testid="override-cancel"
              >
                {labels.overrideCancel}
              </Button>
            )}
          </div>
        </fieldset>
      )}
    </section>
  )
}
