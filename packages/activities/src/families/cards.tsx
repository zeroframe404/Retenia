import { GRADES, type Grade } from '@retenia/core'
import { Button, cn } from '@retenia/ui'
import { useState } from 'react'
import { RichText } from '../components/rich-text'
import { useFamilyActivity } from '../host/activity-context'

/**
 * The `cards` family (§7): `flashcard_basic`, `flashcard_reverse` and `dialog_cards`.
 *
 * These are the M-self types of §3 — *"the user chooses"* — so the grade buttons are not a
 * presentation of a grade the engine computed, they **are** the answer: pressing one sets
 * `response.rating`, and the family grader hands that straight back as the rating. The card must
 * therefore be flipped before the buttons appear, or the self-assessment would be about nothing.
 *
 * `dialog_cards` (§4 row 3, "I knew it / no") is the same M-self grader with a two-button variant
 * of the same UI rather than a renderer of its own — exactly the `payload.mode`-style extension
 * point the registry doc calls for. "I knew it" reports `Good` (a clean recall) and "No" reports
 * `Again`; the four-way "Hard vs. Easy" distinction has no honest answer on a front the learner
 * never had to produce, only recognize.
 */
export function Renderer() {
  const { activity, submit, locked, labels } = useFamilyActivity('cards')
  const [revealed, setRevealed] = useState(false)
  const card = activity.payload.cards[0]
  if (!card) return null
  const isDialog = activity.type === 'dialog_cards'

  function grade(rating: Grade) {
    // M-self: the button press *is* the answer, so it is handed to the grader in the same call
    // rather than through a `respond` the submit would have to wait a render for.
    submit({ rating })
  }

  return (
    <div className="flex flex-col gap-4" data-testid="renderer-cards">
      <section className="border-border rounded-lg border p-4">
        <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">{labels.front}</h3>
        <RichText>{card.front}</RichText>
      </section>

      {revealed ? (
        <section
          className="border-border rounded-lg border p-4"
          data-testid="card-back"
          aria-live="polite"
        >
          <h3 className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.back}
          </h3>
          <RichText>{card.back}</RichText>
        </section>
      ) : (
        <Button
          onClick={() => setRevealed(true)}
          disabled={locked}
          data-testid="reveal-button"
          className="self-start"
        >
          {labels.revealAnswer}
        </Button>
      )}

      {revealed && (
        <fieldset className="flex flex-col gap-2" disabled={locked} data-testid="self-grade">
          <legend className="text-muted text-xs font-semibold uppercase tracking-wide">
            {labels.selfGradeHeading}
          </legend>
          <div className="flex flex-wrap gap-2">
            {isDialog ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => grade(1)}
                  data-testid="grade-1"
                  className="text-incorrect"
                >
                  {labels.selfRatingForgot}
                </Button>
                <Button variant="primary" onClick={() => grade(3)} data-testid="grade-3">
                  {labels.selfRatingKnew}
                </Button>
              </>
            ) : (
              GRADES.map((rating) => (
                <Button
                  key={rating}
                  variant={rating === 1 ? 'outline' : 'primary'}
                  onClick={() => grade(rating)}
                  data-testid={`grade-${rating}`}
                  className={cn(rating === 1 && 'text-incorrect')}
                >
                  {labels.selfGrade[rating]}
                </Button>
              ))
            )}
          </div>
        </fieldset>
      )}
    </div>
  )
}
