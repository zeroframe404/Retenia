import type { Activity, GradeResult } from '@retenia/activity-schema'
import {
  sampleCards,
  sampleChoice,
  sampleDisclosure,
  sampleTextInput,
} from '@retenia/activity-schema/testing'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../index'
import type { ActivityEvent } from '../events'
import { completionOf } from '../testing/completion'
import { ActivityHost, type ActivityHostProps } from './activity-host'
import type { ActivityCompletion } from './use-activity-machine'

/**
 * `<ActivityHost/>` end to end over real activities and the real graders — the machine, the
 * chrome, the events and the rating, with only the ports stubbed.
 */

function renderHost(props: Partial<ActivityHostProps> & { activity: Activity }) {
  return render(<ActivityHost seed="test-seed" {...props} />)
}

/** Waits for the lazy family renderer to arrive. */
async function ready(testId: string) {
  return screen.findByTestId(testId)
}

describe('<ActivityHost/> — the study flow', () => {
  it('presents the prompt, mounts the family renderer and starts unlocked', async () => {
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')

    expect(screen.getByTestId('activity-host')).toHaveAttribute('data-status', 'presenting')
    expect(screen.getByTestId('activity-host')).toHaveAttribute('data-family', 'choice')
    expect(screen.getByText('¿Cuál es la capital de Francia?')).toBeInTheDocument()
    expect(screen.getByTestId('check-button')).toBeEnabled()
  })

  it('answers, grades and shows the feedback panel with the verdict', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    expect(screen.getByTestId('activity-host')).toHaveAttribute('data-status', 'answering')

    await user.click(screen.getByTestId('check-button'))
    const panel = await screen.findByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-tone', 'correct')
    expect(within(panel).getByText('100%')).toBeInTheDocument()
  })

  it('locks the renderer once a grade exists', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')
    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')

    expect(screen.getByTestId('option-b')).toBeDisabled()
    expect(screen.queryByTestId('check-button')).not.toBeInTheDocument()
  })

  it('rates the answer through toRating, so the completion carries an FSRS grade', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: sampleChoice(), onComplete })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const completion = completionOf(onComplete)
    expect(completion.outcome).toBe('graded')
    expect(completion.attempts).toBe(1)
    expect(completion.result?.correct).toBe(true)
    expect(completion.result?.rating).toBe(3)
  })

  it('grades an untouched activity as an empty answer instead of crashing', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('check-button'))
    const panel = await screen.findByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-tone', 'incorrect')
  })
})

describe('<ActivityHost/> — retries', () => {
  function retryable(): Activity {
    const activity = sampleChoice()
    return { ...activity, grading: { ...activity.grading, maxAttempts: 2 } }
  }

  it('offers a retry on a wrong answer and takes the user back to answering', async () => {
    const user = userEvent.setup()
    renderHost({ activity: retryable() })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-b'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('retry-button'))

    expect(screen.getByTestId('activity-host')).toHaveAttribute('data-status', 'answering')
    expect(screen.queryByTestId('feedback-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('attempt-count')).toHaveTextContent('Attempt 2')
  })

  it('offers no retry on a correct answer', async () => {
    const user = userEvent.setup()
    renderHost({ activity: retryable() })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument()
  })

  it('offers no retry once the attempts are spent (the default is one)', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-b'))
    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument()
  })
})

describe('<ActivityHost/> — hints', () => {
  function hinted(): Activity {
    const activity = sampleChoice()
    return {
      ...activity,
      hints: ['Empieza con P.', 'Está sobre el Sena.'],
      grading: { ...activity.grading, hintPenalty: 0.25 },
    }
  }

  it('reveals the hints one at a time, weakest first', async () => {
    const user = userEvent.setup()
    renderHost({ activity: hinted() })
    await ready('renderer-choice')

    expect(screen.getByTestId('hint-button')).toHaveTextContent('Hint (0/2)')
    await user.click(screen.getByTestId('hint-button'))

    const list = screen.getByTestId('hint-list')
    expect(within(list).getByText('Empieza con P.')).toBeInTheDocument()
    expect(within(list).queryByText('Está sobre el Sena.')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('hint-button'))
    expect(within(screen.getByTestId('hint-list')).getByText('Está sobre el Sena.')).toBeVisible()
    expect(screen.getByTestId('hint-button')).toBeDisabled()
  })

  it('charges the hint penalty to the score, without turning a right answer wrong', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: hinted(), onComplete })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('hint-button'))
    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const completion = completionOf(onComplete)
    expect(completion.result?.score).toBeCloseTo(0.75)
    expect(completion.result?.correct).toBe(true)
    expect(completion.hintsUsed).toBe(1)
  })

  it('shows no hint button at all when the activity carries no hints', async () => {
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')
    expect(screen.queryByTestId('hint-button')).not.toBeInTheDocument()
  })
})

describe('<ActivityHost/> — test mode', () => {
  it('defers the feedback, shows the timer and offers no hints', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    const activity = { ...sampleChoice(), hints: ['Empieza con P.'] }
    renderHost({ activity, mode: 'test', onComplete })
    await ready('renderer-choice')

    expect(screen.getByTestId('activity-timer')).toBeInTheDocument()
    expect(screen.queryByTestId('hint-button')).not.toBeInTheDocument()
    expect(screen.getByTestId('deferred-feedback')).toBeInTheDocument()

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(screen.queryByTestId('feedback-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('activity-host')).toHaveAttribute('data-status', 'completed')
    // The exam layer still gets the grade — it just shows it at the end.
    expect(completionOf(onComplete).result?.correct).toBe(true)
  })

  it('locks the UI once the answer is in', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice(), mode: 'test' })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))

    await waitFor(() => expect(screen.getByTestId('option-a')).toBeDisabled())
    expect(screen.queryByTestId('check-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('skip-button')).not.toBeInTheDocument()
  })

  it('shows no timer in study mode unless the activity has a time limit', async () => {
    const { unmount } = renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')
    expect(screen.queryByTestId('activity-timer')).not.toBeInTheDocument()
    unmount()

    const activity = sampleChoice()
    renderHost({ activity: { ...activity, grading: { ...activity.grading, timeLimitSec: 30 } } })
    await ready('renderer-choice')
    expect(screen.getByTestId('activity-timer')).toBeInTheDocument()
  })
})

describe('<ActivityHost/> — the timer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    return () => vi.useRealTimers()
  })

  it('counts down and submits what is on screen when the time runs out', async () => {
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    const activity = sampleChoice()
    renderHost({
      activity: { ...activity, grading: { ...activity.grading, timeLimitSec: 2 } },
      mode: 'test',
      onComplete,
    })
    await ready('renderer-choice')
    expect(screen.getByTestId('activity-timer')).toHaveTextContent('0:02')

    await vi.advanceTimersByTimeAsync(2_100)

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const completion = completionOf(onComplete)
    expect(completion.outcome).toBe('graded')
    expect(completion.result?.correct).toBe(false)
  })
})

describe('<ActivityHost/> — the xAPI-like bus', () => {
  it('emits presented → answered → graded → completed, with skills, mode and seed', async () => {
    const user = userEvent.setup()
    const events: ActivityEvent[] = []
    renderHost({ activity: sampleChoice(), mode: 'review', onEvent: (e) => events.push(e) })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(events.map((event) => event.verb)).toContain('completed'))
    expect(events.map((event) => event.name)).toEqual([
      'activity.presented',
      'activity.answered',
      'activity.graded',
      'activity.completed',
    ])
    const graded = events.find((event) => event.verb === 'graded')
    expect(graded?.object).toEqual({
      id: sampleChoice().id,
      type: 'mcq_single',
      family: 'choice',
    })
    expect(graded?.result).toMatchObject({ score: 1, success: true })
    expect(graded?.result?.duration).toMatch(/^PT[\d.]+S$/)
    expect(graded?.context).toMatchObject({
      skills: ['capital-francia'],
      mode: 'review',
      seed: 'test-seed',
    })
  })

  it('emits activity.skipped instead of completed when the activity is skipped', async () => {
    const user = userEvent.setup()
    const events: ActivityEvent[] = []
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: sampleChoice(), onEvent: (e) => events.push(e), onComplete })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('skip-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(events.map((event) => event.name)).toEqual(['activity.presented', 'activity.skipped'])
    expect(completionOf(onComplete).outcome).toBe('skipped')
  })

  it('emits one graded event per attempt', async () => {
    const user = userEvent.setup()
    const events: ActivityEvent[] = []
    const activity = sampleChoice()
    renderHost({
      activity: { ...activity, grading: { ...activity.grading, maxAttempts: 2 } },
      onEvent: (event) => events.push(event),
    })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-b'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('retry-button'))
    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')

    const graded = events.filter((event) => event.verb === 'graded')
    expect(graded).toHaveLength(2)
    expect(graded[0]?.result?.success).toBe(false)
    expect(graded[1]?.result?.success).toBe(true)
  })
})

describe('<ActivityHost/> — the Explain button', () => {
  it('shows the authored explanation through the default static port', async () => {
    const user = userEvent.setup()
    const activity = { ...sampleChoice(), explanation: 'París es la capital desde 987.' }
    renderHost({ activity })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('explain-button'))

    expect(await screen.findByTestId('explanation')).toHaveTextContent(
      'París es la capital desde 987.',
    )
  })

  it('calls the injected port with the activity, the answer and the grade', async () => {
    const user = userEvent.setup()
    const explainAnswer = vi.fn().mockResolvedValue('Porque sí.')
    renderHost({ activity: sampleChoice(), explainAnswer })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('explain-button'))

    await waitFor(() => expect(explainAnswer).toHaveBeenCalled())
    expect(explainAnswer.mock.calls[0]?.[0]).toMatchObject({
      lang: 'es-AR',
      response: { sets: [{ selected: ['a'] }] },
      result: expect.objectContaining({ correct: true }),
    })
    expect(await screen.findByTestId('explanation')).toHaveTextContent('Porque sí.')
  })

  it('reports a failed explanation instead of hanging on "Thinking…"', async () => {
    const user = userEvent.setup()
    const explainAnswer = vi.fn().mockRejectedValue(new Error('offline'))
    renderHost({ activity: sampleChoice(), explainAnswer })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('explain-button'))

    expect(await screen.findByTestId('explanation-error')).toBeInTheDocument()
  })

  it('hides the button when there is neither an explanation nor a tutor', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleChoice() })
    await ready('renderer-choice')
    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')

    expect(screen.queryByTestId('explain-button')).not.toBeInTheDocument()
  })
})

describe('<ActivityHost/> — grading failures', () => {
  it('surfaces the failure and leaves the answer editable', async () => {
    const user = userEvent.setup()
    const grade = vi.fn().mockRejectedValue(new Error('the model is down'))
    renderHost({ activity: sampleChoice(), grade })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('option-a'))
    await user.click(screen.getByTestId('check-button'))

    expect(await screen.findByTestId('grade-error')).toBeInTheDocument()
    expect(screen.getByTestId('option-b')).toBeEnabled()
    expect(screen.queryByTestId('feedback-panel')).not.toBeInTheDocument()
  })

  it('recovers on the next check', async () => {
    const user = userEvent.setup()
    const good: GradeResult = {
      score: 1,
      correct: true,
      feedback: '',
      rating: 3,
      meta: { timeMs: 1, attempts: 1, hintsUsed: 0 },
    }
    const grade = vi.fn().mockRejectedValueOnce(new Error('flaky')).mockResolvedValue(good)
    renderHost({ activity: sampleChoice(), grade })
    await ready('renderer-choice')

    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('grade-error')
    await user.click(screen.getByTestId('check-button'))

    expect(await screen.findByTestId('feedback-panel')).toHaveAttribute('data-tone', 'correct')
  })
})

describe('<ActivityHost/> — the deterministic shuffle', () => {
  function optionOrder(): string[] {
    return [...screen.getByTestId('choice-set-s1').querySelectorAll('input')].map(
      (input) => input.value,
    )
  }

  it('presents the same order for the same seed', async () => {
    const { unmount } = renderHost({ activity: sampleChoice(), seed: 'session-a' })
    await ready('renderer-choice')
    const first = optionOrder()
    unmount()

    renderHost({ activity: sampleChoice(), seed: 'session-a' })
    await ready('renderer-choice')
    expect(optionOrder()).toEqual(first)
  })

  it('presents a different order for a different seed, with the same options', async () => {
    const { unmount } = renderHost({ activity: sampleChoice(), seed: 'session-a' })
    await ready('renderer-choice')
    const first = optionOrder()
    unmount()

    renderHost({ activity: sampleChoice(), seed: 'session-z' })
    await ready('renderer-choice')
    const second = optionOrder()
    expect(second).not.toEqual(first)
    expect([...second].sort()).toEqual([...first].sort())
  })

  it('honours grading.shuffle: false — a chat or a timeline keeps its authored order', async () => {
    const activity = sampleChoice()
    renderHost({
      activity: { ...activity, grading: { ...activity.grading, shuffle: false } },
      seed: 'session-z',
    })
    await ready('renderer-choice')
    expect(optionOrder()).toEqual(['a', 'b', 'c'])
  })
})

describe('<ActivityHost/> — the other MVP families', () => {
  it('renders a flashcard, reveals the back and takes the self-grade as the answer', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: sampleCards(), onComplete })
    await ready('renderer-cards')

    expect(screen.queryByTestId('self-grade')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('reveal-button'))
    expect(screen.getByTestId('card-back')).toHaveTextContent('París')

    await user.click(screen.getByTestId('grade-4'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.rating).toBe(4)
  })

  it('grades a short answer through the fuzzy matcher', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleTextInput() })
    await ready('renderer-text_input')

    await user.type(screen.getByTestId('text-input'), 'paris')
    await user.click(screen.getByTestId('check-button'))

    expect(await screen.findByTestId('feedback-panel')).toHaveAttribute('data-tone', 'correct')
  })

  it('tracks which theory sections were opened, and schedules nothing', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: sampleDisclosure(), onComplete })
    await ready('renderer-disclosure')

    await user.click(screen.getByText('Primera ley'))
    await user.click(screen.getByTestId('check-button'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const completion = completionOf(onComplete)
    expect(completion.result?.score).toBeCloseTo(0.5)
    expect(completion.result?.rating).toBeNull()
  })
})

describe('<ActivityHost/> — dialog_cards, the two-button self rating', () => {
  function dialogCards(): Activity {
    const base = sampleCards()
    return { ...base, type: 'dialog_cards', payload: { ...base.payload, presentation: 'dialog' } }
  }

  it('offers "I knew it" / "No" instead of the four-grade fieldset', async () => {
    const user = userEvent.setup()
    renderHost({ activity: dialogCards() })
    await ready('renderer-cards')
    await user.click(screen.getByTestId('reveal-button'))

    expect(screen.queryByTestId('grade-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('grade-4')).not.toBeInTheDocument()
    expect(screen.getByTestId('grade-1')).toHaveTextContent('No')
    expect(screen.getByTestId('grade-3')).toHaveTextContent('I knew it')
  })

  it('"I knew it" reports a Good rating', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: dialogCards(), onComplete })
    await ready('renderer-cards')
    await user.click(screen.getByTestId('reveal-button'))
    await user.click(screen.getByTestId('grade-3'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.rating).toBe(3)
  })

  it('"No" reports an Again rating', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ activity: dialogCards(), onComplete })
    await ready('renderer-cards')
    await user.click(screen.getByTestId('reveal-button'))
    await user.click(screen.getByTestId('grade-1'))
    await user.click(await screen.findByTestId('continue-button'))

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.rating).toBe(1)
  })
})

describe('<ActivityHost/> — text_input near-miss diff', () => {
  it('shows a character-level diff instead of the plain model answer on a near miss', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleTextInput() })
    await ready('renderer-text_input')

    // Two substitutions against "París" (normalized "paris"): a relative edit distance of 0.4,
    // over the FUZ tolerance of 0.2, so it grades incorrect but with real partial credit.
    await user.type(screen.getByTestId('text-input'), 'Parxz')
    await user.click(screen.getByTestId('check-button'))

    const panel = await screen.findByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-tone', 'partial')
    expect(screen.queryByTestId('model-answer')).not.toBeInTheDocument()

    const diff = screen.getByTestId('answer-diff')
    expect(diff).toHaveTextContent('Parxz')
    expect(diff).toHaveTextContent('París')
    expect(diff.querySelector('.line-through')).not.toBeNull()
    expect(diff.querySelector('.underline')).not.toBeNull()
  })

  it('also shows the diff for inputKind "letters" (short_answer/valid-3), not just "text"', async () => {
    const user = userEvent.setup()
    const base = sampleTextInput()
    const activity: Activity = {
      ...base,
      payload: { ...base.payload, inputKind: 'letters', answers: [{ value: 'murciélago' }] },
    }
    renderHost({ activity })
    await ready('renderer-text_input')

    // Fixtures/short_answer/valid-3.json's own "wrong" case: score ≤ 0.6, correct: false.
    await user.type(screen.getByTestId('text-input'), 'vampiro')
    await user.click(screen.getByTestId('check-button'))

    const panel = await screen.findByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-tone', 'partial')
    expect(screen.getByTestId('answer-diff')).toHaveTextContent('murciélago')
  })

  it('keeps the plain model answer, not a diff, on a total miss', async () => {
    const user = userEvent.setup()
    renderHost({ activity: sampleTextInput() })
    await ready('renderer-text_input')

    await user.click(screen.getByTestId('check-button'))
    const panel = await screen.findByTestId('feedback-panel')
    expect(panel).toHaveAttribute('data-tone', 'incorrect')
    expect(screen.getByTestId('model-answer')).toHaveTextContent('París')
    expect(screen.queryByTestId('answer-diff')).not.toBeInTheDocument()
  })
})

describe('<ActivityHost/> — an unregistered type', () => {
  it('says so instead of crashing', async () => {
    const activity = sampleChoice()
    renderHost({ activity: { ...activity, type: 'odd_one_out' } })
    expect(await screen.findByTestId('unsupported-type')).toBeInTheDocument()
  })
})
