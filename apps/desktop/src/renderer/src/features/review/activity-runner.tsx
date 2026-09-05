import { ActivityHost } from '@retenia/activities'
import { safeParseActivity } from '@retenia/activity-schema'
import { useMemo } from 'react'
import type { ActivityAnswer, ReviewActivityDto, ReviewGrade } from './use-review-session'

/**
 * One scheduled exercise, mounted in the review queue (`docs/spec/03-activities.md` §5).
 *
 * The bridge between two things that deliberately know nothing about each other: the session
 * runner, which schedules **skills** and speaks ratings, and `<ActivityHost/>`, which renders
 * **one activity** and speaks `GradeResult`. The join is §3's M-* mapping, and it has already
 * happened by the time the completion arrives — `toRating` ran inside the host — so all this
 * has to do is carry the evidence across without losing any of it.
 */

export interface ActivityRunnerProps {
  served: NonNullable<ReviewActivityDto>
  disabled: boolean
  onAnswer: (input: ActivityAnswer) => void
  /**
   * The activity produced no rating of its own: an M-self type where the button is the
   * learner's to press, or an AI rubric that declined to commit. The screen then shows the
   * grade buttons, which is exactly what `reviewActivity`'s `awaiting-user` means.
   */
  onAwaitingRating: () => void
  /** Rendered instead when the stored activity will not parse. */
  fallback: React.ReactNode
}

export function ActivityRunner({
  served,
  disabled,
  onAnswer,
  onAwaitingRating,
  fallback,
}: ActivityRunnerProps) {
  const parsed = useMemo(() => safeParseActivity(served.activity), [served.activity])

  const activity = useMemo(() => {
    if (!parsed.success) return null
    // Legendary withholds hints without being a *mode*: the host reads `hints.length`, so an
    // activity served with hints suppressed is one with no hints to reveal.
    return served.hintsAllowed ? parsed.data : { ...parsed.data, hints: [] }
  }, [parsed, served.hintsAllowed])

  // A stored activity that no longer parses is a content bug, not a reason to lose the
  // review: the card is still due, and the flashcard is always a valid way to ask it.
  if (activity === null) return <>{fallback}</>

  return (
    <div data-testid="review-activity" data-activity-type={served.type}>
      <ActivityHost
        // Remounts on a new activity so the machine starts at `idle` rather than resuming
        // the previous card's `feedback` state.
        key={served.attemptId}
        activity={activity}
        mode={served.mode}
        seed={served.seed}
        onComplete={(completion) => {
          if (disabled) return
          const rating = completion.result?.rating ?? null
          if (rating === null) {
            onAwaitingRating()
            return
          }
          onAnswer({
            rating: rating as ReviewGrade,
            exerciseScore: completion.result?.score ?? null,
            // The host's own timer, which measured the answer more precisely than the
            // runner's per-card one could.
            durationMs: completion.durationMs,
            attemptId: served.attemptId,
            activityId: served.activityId,
            attempt: {
              answer: (completion.response ?? null) as NonNullable<
                ActivityAnswer['attempt']
              >['answer'],
              correct: completion.result?.correct ?? null,
              feedback: completion.result?.feedback ?? null,
              tries: completion.attempts,
              hintsUsed: completion.hintsUsed,
            },
          })
        }}
      />
    </div>
  )
}
