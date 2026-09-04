import { Button } from '@retenia/ui'
import { LightbulbIcon } from 'lucide-react'
import { useActivity } from '../host/activity-context'
import { formatLabel } from '../labels'
import { RichText } from './rich-text'

/**
 * §2's "maximum attempts with progressive hints": the hints of the envelope are revealed one at a
 * time, weakest first, and each one costs `grading.hintPenalty` of the score (applied by the host,
 * see `applyHintPenalty`).
 *
 * The button disappears entirely in `test` mode and under the "Legendary" no-hints policy of §12 —
 * both reach here as `hintsAvailable: false`, so the exam UI needs no special case.
 */
export function HintButton() {
  const { activity, canHint, hintsAvailable, hintsUsed, requestHint, revealedHints, labels } =
    useActivity()
  const total = activity.hints?.length ?? 0
  if (!hintsAvailable) return null

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={requestHint}
        disabled={!canHint}
        data-testid="hint-button"
        className="self-start"
      >
        <LightbulbIcon aria-hidden className="size-4" />
        {formatLabel(labels.hint, { used: hintsUsed, total })}
      </Button>
      {revealedHints.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          data-testid="hint-list"
          className="border-border bg-surface flex flex-col gap-2 rounded-md border p-3"
        >
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.hintHeading}
          </h3>
          {revealedHints.map((hint) => (
            <RichText key={hint} className="text-sm">
              {hint}
            </RichText>
          ))}
        </div>
      )}
    </div>
  )
}
