import { sampleCards, sampleChoice } from '@retenia/activity-schema/testing/samples'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { ActivityRunner } from './activity-runner'
import type { ReviewActivityDto } from './use-review-session'

/**
 * The seam between the scheduler and the activity engine: a graded exercise has to reach
 * `session.answer` carrying everything §10 records — the rating, the grader's continuous
 * score, the measured time and the `attempts` row — and an exercise that cannot rate itself
 * has to hand back to the four buttons rather than swallow the review.
 */

function served(overrides: Partial<NonNullable<ReviewActivityDto>> = {}) {
  return {
    attemptId: '0192f000-0000-7000-8000-000000000004',
    activityId: sampleChoice().id,
    type: 'mcq_single',
    activity: sampleChoice() as unknown as NonNullable<ReviewActivityDto>['activity'],
    mode: 'review' as const,
    hintsAllowed: true,
    deferFeedback: false,
    seed: 'seed',
    ...overrides,
  } as NonNullable<ReviewActivityDto>
}

const FALLBACK = <div data-testid="card-body">flashcard</div>

afterEach(cleanup)

describe('ActivityRunner', () => {
  it('renders the exercise instead of the flashcard', () => {
    render(
      <ActivityRunner
        served={served()}
        disabled={false}
        onAnswer={vi.fn()}
        onAwaitingRating={vi.fn()}
        fallback={FALLBACK}
      />,
    )
    expect(screen.getByTestId('review-activity')).toBeInTheDocument()
    expect(screen.queryByTestId('card-body')).not.toBeInTheDocument()
  })

  it('falls back to the flashcard when the stored activity will not parse', () => {
    // A content bug must not cost the learner the review: the card is still due.
    render(
      <ActivityRunner
        served={served({
          activity: { nonsense: true } as unknown as NonNullable<ReviewActivityDto>['activity'],
        })}
        disabled={false}
        onAnswer={vi.fn()}
        onAwaitingRating={vi.fn()}
        fallback={FALLBACK}
      />,
    )
    expect(screen.getByTestId('card-body')).toBeInTheDocument()
    expect(screen.queryByTestId('review-activity')).not.toBeInTheDocument()
  })

  it('carries the score, the measured time and the attempt id to the answer', async () => {
    const onAnswer = vi.fn()
    const user = userEvent.setup()
    render(
      <ActivityRunner
        served={served()}
        disabled={false}
        onAnswer={onAnswer}
        onAwaitingRating={vi.fn()}
        fallback={FALLBACK}
      />,
    )
    // The family renderers are lazy-loaded, so the first query has to wait for the chunk.
    await user.click(await screen.findByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1))
    const input = onAnswer.mock.calls[0]?.[0]
    expect(input.rating).toBeGreaterThanOrEqual(1)
    expect(input.exerciseScore).toBe(1)
    expect(input.attemptId).toBe('0192f000-0000-7000-8000-000000000004')
    expect(input.activityId).toBe(sampleChoice().id)
    expect(input.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('sends nothing until a self-rated type has actually been rated', async () => {
    // `cards` is M-self (§3): the button is the learner's to press, so nothing may reach
    // `session.answer` on mount. When the run ends without a rating the runner calls
    // `onAwaitingRating` and the screen falls through to the four grade buttons.
    const onAwaitingRating = vi.fn()
    const onAnswer = vi.fn()
    render(
      <ActivityRunner
        served={served({
          type: 'flashcard_basic',
          activityId: sampleCards().id,
          activity: sampleCards() as unknown as NonNullable<ReviewActivityDto>['activity'],
        })}
        disabled={false}
        onAnswer={onAnswer}
        onAwaitingRating={onAwaitingRating}
        fallback={FALLBACK}
      />,
    )
    expect(screen.getByTestId('review-activity')).toBeInTheDocument()
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('strips the hints an activity offers when the policy withheld them', () => {
    // Legendary is not a *mode*, and the host counts hints off the envelope — so "no hints"
    // has to arrive as an activity with none.
    const withHints = { ...sampleChoice(), hints: ['empieza con P'] }
    render(
      <ActivityRunner
        served={served({
          activity: withHints as unknown as NonNullable<ReviewActivityDto>['activity'],
          hintsAllowed: false,
        })}
        disabled={false}
        onAnswer={vi.fn()}
        onAwaitingRating={vi.fn()}
        fallback={FALLBACK}
      />,
    )
    expect(screen.queryByTestId('hint-button')).not.toBeInTheDocument()
  })
})
