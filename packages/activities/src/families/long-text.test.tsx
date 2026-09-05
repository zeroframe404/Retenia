import { createFakeAiGrader } from '@retenia/activity-graders'
import type { Activity, GradeResult } from '@retenia/activity-schema'
import { sampleEssayRubric, sampleLongText } from '@retenia/activity-schema/testing'
import type { AiGradeResult, AiGrader } from '@retenia/core'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../index'
import { ActivityHost, type ActivityHostProps } from '../host/activity-host'
import type { ActivityCompletion } from '../host/use-activity-machine'
import { createAiGradePort } from '../host/use-activity-machine'
import { completionOf } from '../testing/completion'

/**
 * The `long_text` family end to end (`docs/spec/03-activities.md` §10's **AI** row and
 * `docs/spec/04-path-generation.md` §12): a textarea, a rubric grade, the model answer, and the
 * rating the learner is allowed to disagree with.
 *
 * Everything here runs over the real `<ActivityHost/>`, the real renderer and the real
 * `createLongTextAiGrader` — only the `AiGrader` port itself is a double, which is exactly the
 * seam sub-phase 5.5 exists to create.
 */

/**
 * `userEvent` types a sentence one keystroke at a time, re-rendering the host on each, and then
 * runs a whole grade cycle. Every `describe` below contains at least one such test; they take
 * ~0.5 s each locally, comfortably inside Vitest's 5 s default — until `pnpm test` runs sixteen
 * packages at once on a Windows CI runner, where this file has been measured at a ~50x
 * slowdown (transform 104 s against 1.8 s) and the heaviest of them times out.
 *
 * Same remedy, and same reasoning, as `SLOW_SIMULATION_MS` in
 * `packages/core/src/memory/simulator.test.ts`: only the clock is relaxed. Not one assertion,
 * and not one line of any test body, changes.
 */
const SLOW_INTERACTION_MS = 30_000

const NO_PACE = { medianMs: null }

const FULL_ANSWER =
  'Los repasos distribuidos obligan a la recuperación activa cuando el olvido ya empezó.'

function renderHost(props: Partial<ActivityHostProps> & { activity: Activity }) {
  return render(<ActivityHost seed="test-seed" {...props} />)
}

function aiResult(overrides: Partial<AiGradeResult> = {}): AiGradeResult {
  return {
    perCriterion: [
      {
        id: 'c1',
        criterion: 'Explica el mecanismo del espaciado',
        score: 1,
        weight: 2,
        level: 'Explica por qué el intervalo ayuda.',
        comment: 'Nombra el olvido y el intervalo.',
      },
      { id: 'c2', criterion: 'Contrasta con el estudio masivo', score: 0, weight: 1 },
    ],
    score: 2 / 3,
    rating: 2,
    feedback: 'Explicás bien el mecanismo; falta contrastar con el estudio masivo.',
    uncertain: false,
    evidence: [{ quote: 'Los repasos distribuidos', criterionId: 'c1' }],
    engine: 'ai',
    injectionSuspected: false,
    ...overrides,
  }
}

function gradePortFor(grader: AiGrader) {
  return createAiGradePort(grader, NO_PACE)
}

async function answerAndCheck(user: ReturnType<typeof userEvent.setup>, text: string) {
  await screen.findByTestId('renderer-long_text')
  await user.type(screen.getByTestId('long-text-input'), text)
  await user.click(screen.getByTestId('check-button'))
  return screen.findByTestId('feedback-panel')
}

describe('the long_text renderer', { timeout: SLOW_INTERACTION_MS }, () => {
  it('counts words against the activity’s range and says Markdown is allowed', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleEssayRubric() })
    await screen.findByTestId('renderer-long_text')

    expect(screen.getByTestId('word-count')).toHaveTextContent('0 words (40–120)')
    await user.type(screen.getByTestId('long-text-input'), 'tres palabras acá')
    expect(screen.getByTestId('word-count')).toHaveTextContent('3 words (40–120)')
    // Below the minimum is flagged, never blocked — the answer can still be submitted.
    expect(screen.getByTestId('word-count')).toHaveAttribute('data-out-of-range', 'true')
    expect(screen.getByTestId('check-button')).toBeEnabled()
    expect(screen.getByText('Markdown is allowed.')).toBeInTheDocument()
  })

  it('counts plain words when the activity sets no range', async () => {
    renderHost({ activity: sampleLongText() })
    await screen.findByTestId('renderer-long_text')
    expect(screen.getByTestId('word-count')).toHaveTextContent('0 words')
    expect(screen.getByTestId('word-count')).toHaveAttribute('data-out-of-range', 'false')
  })

  it('shows neither the key points nor the model answer before a grade exists', async () => {
    renderHost({ activity: sampleEssayRubric() })
    await screen.findByTestId('renderer-long_text')
    expect(screen.queryByTestId('key-points')).not.toBeInTheDocument()
    expect(screen.queryByTestId('model-answer')).not.toBeInTheDocument()
  })
})

describe('an essay graded end to end by the fake grader', { timeout: SLOW_INTERACTION_MS }, () => {
  it('runs offline: score, rubric breakdown, model answer and an estimate label', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(createFakeAiGrader()),
      onComplete,
    })

    const panel = await answerAndCheck(user, FULL_ANSWER)
    expect(panel).toHaveAttribute('data-tone', 'correct')
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('100%')

    // §10: the model answer is shown whatever the score.
    expect(screen.getByTestId('model-answer')).toHaveTextContent('distribuye los repasos')
    // …and the key points are ticked off from the same `perItem` the matcher produces.
    expect(screen.getByTestId('key-point-k1')).toHaveAttribute('data-covered', 'true')
    expect(screen.getByTestId('key-point-k2')).toHaveAttribute('data-covered', 'true')

    // §6 of `01-decisions.md`: an estimate that cost nothing is labelled as one.
    expect(screen.getByTestId('estimated-grade')).toBeInTheDocument()
    expect(screen.getByTestId('criterion-c1')).toHaveAttribute('data-score', '1')

    await user.click(screen.getByTestId('continue-button'))
    const completion = completionOf(onComplete)
    expect(completion.result?.meta.engine).toBe('fake')
    expect(completion.result?.rating).toBe(4)
  })

  it('never calls the grader for an empty answer, and files it as Again', async () => {
    const user = userEvent.setup()
    const grader = vi.fn<AiGrader>(async () => aiResult())
    renderHost({ activity: sampleEssayRubric(), grade: gradePortFor(grader) })

    await screen.findByTestId('renderer-long_text')
    await user.click(screen.getByTestId('check-button'))
    const panel = await screen.findByTestId('feedback-panel')

    // The port is never reached: the local pre-grade settles an empty answer on its own.
    expect(grader).not.toHaveBeenCalled()
    expect(within(panel).getByRole('heading', { level: 2 })).toHaveTextContent('0%')
    expect(screen.getByTestId('rating-value')).toHaveTextContent('Again')
    // `engine: 'local'` — the pre-grader decided, so this is not an "estimate" standing in for
    // a grade that could not be had; it is the grade.
    expect(screen.queryByTestId('estimated-grade')).not.toBeInTheDocument()
  })
})

describe('the rubric breakdown', { timeout: SLOW_INTERACTION_MS }, () => {
  it('shows a score, an anchor and a comment per criterion, and the quotes from the answer', async () => {
    const user = userEvent.setup()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () => aiResult()),
    })

    const panel = await answerAndCheck(user, FULL_ANSWER)
    const breakdown = within(panel).getByTestId('rubric-breakdown')
    expect(within(breakdown).getByText('Explica el mecanismo del espaciado')).toBeInTheDocument()
    expect(within(breakdown).getByText('weight 2')).toBeInTheDocument()
    expect(within(breakdown).getByText('Explica por qué el intervalo ayuda.')).toBeInTheDocument()
    expect(within(breakdown).getByText('Nombra el olvido y el intervalo.')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('answer-evidence')).getByText('Los repasos distribuidos'),
    ).toBeInTheDocument()
    // A weight of 1 is the default and is not worth the pixels.
    expect(within(breakdown).queryByText('weight 1')).not.toBeInTheDocument()
  })

  it('shows a repeated quote once', async () => {
    const user = userEvent.setup()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () =>
        aiResult({
          evidence: [
            { quote: 'Los repasos distribuidos', criterionId: 'c1' },
            { quote: 'Los repasos distribuidos', criterionId: 'c1' },
            { quote: 'Los repasos distribuidos', criterionId: 'c2' },
          ],
        }),
      ),
    })
    await answerAndCheck(user, FULL_ANSWER)

    // The same sentence cited twice for the same criterion is one piece of evidence; cited for
    // a different criterion it is a different claim, and stays.
    expect(within(screen.getByTestId('answer-evidence')).getAllByRole('listitem')).toHaveLength(2)
  })

  it('warns when the answer was marked on the rubric alone', async () => {
    const user = userEvent.setup()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () => aiResult({ injectionSuspected: true })),
    })
    await answerAndCheck(user, FULL_ANSWER)
    expect(screen.getByTestId('injection-notice')).toBeInTheDocument()
  })

  it('stays out of the way of a deterministically graded activity', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleLongText() })
    await answerAndCheck(user, 'Con luz solar y CO2 se produce glucosa en la hoja.')

    expect(screen.queryByTestId('rubric-breakdown')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rating-chip')).not.toBeInTheDocument()
  })
})

describe('the rating chip', { timeout: SLOW_INTERACTION_MS }, () => {
  it('shows what the answer will be scheduled as', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleEssayRubric(), grade: gradePortFor(async () => aiResult()) })
    await answerAndCheck(user, FULL_ANSWER)

    expect(screen.getByTestId('rating-chip')).toHaveAttribute('data-rating', '2')
    expect(screen.getByTestId('rating-value')).toHaveTextContent('Hard')
  })

  it('lets the learner override it, recording the change and the reason on the grade', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () => aiResult()),
      onComplete,
    })
    await answerAndCheck(user, FULL_ANSWER)

    await user.click(screen.getByTestId('change-rating-button'))
    await user.click(screen.getByTestId('override-grade-4'))
    await user.type(screen.getByTestId('override-reason'), 'Lo tenía clarísimo.')
    await user.click(screen.getByTestId('override-save'))

    expect(screen.getByTestId('rating-chip')).toHaveAttribute('data-rating', '4')
    expect(screen.getByTestId('rating-overridden')).toHaveTextContent('Lo tenía clarísimo.')

    await user.click(screen.getByTestId('continue-button'))
    const result = completionOf(onComplete).result as GradeResult
    expect(result.rating).toBe(4)
    expect(result.meta.ratingOverride).toMatchObject({
      from: 2,
      to: 4,
      reason: 'Lo tenía clarísimo.',
    })
    expect(result.meta.ratingOverride?.at).toEqual(expect.any(String))
    // The score is the grader's measurement and is not rewritten by the correction.
    expect(result.score).toBeCloseTo(2 / 3, 6)
  })

  it('records an override with no reason given', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () => aiResult()),
      onComplete,
    })
    await answerAndCheck(user, FULL_ANSWER)
    await user.click(screen.getByTestId('change-rating-button'))
    await user.click(screen.getByTestId('override-grade-1'))
    await user.click(screen.getByTestId('override-save'))
    await user.click(screen.getByTestId('continue-button'))

    expect(completionOf(onComplete).result?.meta.ratingOverride).toEqual({
      from: 2,
      to: 1,
      at: expect.any(String),
    })
  })

  it('can be cancelled without touching the rating', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleEssayRubric(), grade: gradePortFor(async () => aiResult()) })
    await answerAndCheck(user, FULL_ANSWER)

    await user.click(screen.getByTestId('change-rating-button'))
    await user.click(screen.getByTestId('override-grade-4'))
    await user.click(screen.getByTestId('override-cancel'))

    expect(screen.queryByTestId('rating-override')).not.toBeInTheDocument()
    expect(screen.getByTestId('rating-chip')).toHaveAttribute('data-rating', '2')
    expect(screen.queryByTestId('rating-overridden')).not.toBeInTheDocument()
  })

  it('opens pre-selected on the rating being corrected', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleEssayRubric(), grade: gradePortFor(async () => aiResult()) })
    await answerAndCheck(user, FULL_ANSWER)
    await user.click(screen.getByTestId('change-rating-button'))

    expect(screen.getByTestId('override-grade-2')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('override-grade-4')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('override-save')).toBeEnabled()
  })
})

describe('an uncertain grade', { timeout: SLOW_INTERACTION_MS }, () => {
  it('schedules nothing and asks the learner to rate it themselves', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({
      activity: sampleEssayRubric(),
      grade: gradePortFor(async () => aiResult({ uncertain: true, rating: null })),
      onComplete,
    })
    await answerAndCheck(user, FULL_ANSWER)

    expect(screen.getByTestId('rating-chip')).toHaveAttribute('data-rating', 'none')
    expect(screen.getByTestId('uncertain-notice')).toBeInTheDocument()
    // The picker is already open — there is nothing to "change" from, and nothing to cancel to.
    expect(screen.getByTestId('rating-override')).toBeInTheDocument()
    expect(screen.queryByTestId('override-cancel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('change-rating-button')).not.toBeInTheDocument()
    // …and nothing is pre-selected, because there is no rating to pre-select.
    expect(screen.getByTestId('override-save')).toBeDisabled()

    await user.click(screen.getByTestId('override-grade-3'))
    await user.click(screen.getByTestId('override-save'))
    await user.click(screen.getByTestId('continue-button'))

    const result = completionOf(onComplete).result as GradeResult
    expect(result.rating).toBe(3)
    expect(result.meta.uncertain).toBe(true)
    expect(result.meta.ratingOverride).toMatchObject({ from: null, to: 3 })
  })
})
