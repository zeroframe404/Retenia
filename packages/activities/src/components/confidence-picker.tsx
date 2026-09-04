import { CONFIDENCE_LEVELS, type ConfidenceLevel } from '@retenia/core'
import { cn } from '@retenia/ui'
import { useActivity } from '../host/activity-context'

/**
 * Certainty-based marking (§2, and `confidence_mcq` in §4): the user says how sure they are, and
 * the answer is logged with it. `GradeMeta.confidence` carries it into the review log, where §10
 * of `docs/spec/02-memory-system.md` uses it to adjust the rating.
 *
 * A radio group rather than three buttons, so a screen reader announces "1 of 3" and the arrow
 * keys move between the options — the same interaction a sighted user gets.
 */

export interface ConfidencePickerProps {
  value: ConfidenceLevel | null
  onChange: (value: ConfidenceLevel) => void
}

export function ConfidencePicker({ value, onChange }: ConfidencePickerProps) {
  const { labels, locked } = useActivity()

  return (
    <fieldset className="flex flex-col gap-2" data-testid="confidence-picker" disabled={locked}>
      <legend className="text-muted text-xs font-semibold uppercase tracking-wide">
        {labels.confidenceHeading}
      </legend>
      <div className="flex flex-wrap gap-2">
        {CONFIDENCE_LEVELS.map((level) => (
          <label
            key={level}
            className={cn(
              'border-border cursor-pointer rounded-full border px-3 py-1 text-sm',
              'has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-2',
              value === level && 'border-brand-500 bg-brand-50 dark:bg-brand-950/40',
              locked && 'cursor-not-allowed opacity-60',
            )}
          >
            <input
              type="radio"
              name="confidence"
              value={level}
              checked={value === level}
              onChange={() => onChange(level)}
              className="sr-only"
            />
            {labels.confidence[level]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
