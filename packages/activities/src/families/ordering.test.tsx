import type { Activity } from '@retenia/activity-schema'
import { sampleOrdering } from '@retenia/activity-schema/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../index'
import { ActivityHost } from '../host/activity-host'
import type { ActivityCompletion } from '../host/use-activity-machine'
import { activityCatalog } from '../testing/catalog'
import { completionOf } from '../testing/completion'

/**
 * The `ordering` renderer against the *grader*, not against the DOM.
 *
 * `keyboard-placement.test.tsx` checks that the list can be reordered and `activity-graders`
 * checks that a response scores what the fixture says, but until this file nothing drove the two
 * together — and they disagreed. The renderer submitted every token it drew, distractors included;
 * `exactScore` (`packages/activity-graders/src/ordering/metrics.ts`) starts by comparing lengths
 * against a `correctOrder` that `packages/activity-schema/src/validate/ordering.ts` guarantees
 * holds `items` alone. `sentence_builder` is forced to `scoring: 'exact'` by that same rule and its
 * generator prompt asks for distractors, so the type's default configuration scored 0 for every
 * correct answer. The first test here is the regression guard for that whole class of bug: build
 * the fixture's own "correct" answer through the real UI and let the real grader mark it.
 */

/** Tabs until `predicate` holds, so a test never hard-codes how many stops a widget has. */
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  predicate: (element: Element) => boolean,
  limit = 80,
): Promise<Element> {
  for (let step = 0; step < limit; step += 1) {
    const active = document.activeElement
    if (active && predicate(active)) return active
    await user.tab()
  }
  throw new Error('tabTo: never reached the element')
}

const byTestId = (id: string) => (element: Element) => element.getAttribute('data-testid') === id

function fixture(id: string): Activity {
  const entry = activityCatalog().find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`${id} is not in the fixture catalogue`)
  return entry.activity
}

/** «She goes to school», four items plus the distractors «go» and «at», graded `exact`. */
const SENTENCE_BUILDER = 'sentence_builder/valid-1.json'
const SENTENCE = ['w1', 'w2', 'w3', 'w4'] as const
const DISTRACTORS = ['d1', 'd2'] as const

function renderHost(activity: Activity, onComplete?: (c: ActivityCompletion) => void) {
  return render(
    <ActivityHost
      activity={activity}
      seed="ordering-seed"
      {...(onComplete ? { onComplete } : {})}
    />,
  )
}

/** The ids in the answer area, top to bottom. */
function idsInAnswer(): string[] {
  return [...screen.getByTestId('ordering-answer').children].map((item) =>
    (item.getAttribute('data-testid') ?? '').replace('ordering-item-', ''),
  )
}

/** Picks a token up and drops it in the answer area, keyboard only. */
async function placeByKeyboard(user: ReturnType<typeof userEvent.setup>, id: string) {
  await tabTo(user, byTestId(`draggable-${id}`))
  await user.keyboard('{Enter}')
  await tabTo(user, byTestId('place-answer'))
  await user.keyboard('{Enter}')
}

describe('ordering with distractors — sentence_builder/valid-1.json', () => {
  it('starts with an empty answer and every token in the bank', async () => {
    renderHost(fixture(SENTENCE_BUILDER))
    await screen.findByTestId('renderer-ordering')

    // Nothing is pre-seeded: with distractors in the pool, seeding the answer would both hand
    // over which tokens belong and make `exact` unwinnable without a removal.
    expect(idsInAnswer()).toEqual([])
    for (const id of [...SENTENCE, ...DISTRACTORS]) {
      expect(screen.getByTestId(`draggable-${id}`)).toBeInTheDocument()
    }
  })

  it('builds the sentence from the keyboard and the grader scores it 1', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(fixture(SENTENCE_BUILDER), onComplete)
    await screen.findByTestId('renderer-ordering')

    for (const id of SENTENCE) await placeByKeyboard(user, id)
    expect(idsInAnswer()).toEqual([...SENTENCE])

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const completion = completionOf(onComplete)
    // The response the fixture calls "correct", produced by the UI rather than written by hand.
    expect(completion.response).toEqual({ order: [...SENTENCE] })
    expect(completion.result?.score).toBe(1)
    expect(completion.result?.correct).toBe(true)
  })

  it('leaves an unused distractor out of the response', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(fixture(SENTENCE_BUILDER), onComplete)
    await screen.findByTestId('renderer-ordering')

    for (const id of SENTENCE) await placeByKeyboard(user, id)
    for (const id of DISTRACTORS) {
      expect(screen.getByTestId(`draggable-${id}`)).toBeInTheDocument()
      expect(screen.queryByTestId(`ordering-item-${id}`)).not.toBeInTheDocument()
    }

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const order = (completionOf(onComplete).response as { order: string[] }).order
    expect(order).not.toContain('d1')
    expect(order).not.toContain('d2')
  })

  it('takes a token placed by mistake back to the bank', async () => {
    const user = userEvent.setup()
    renderHost(fixture(SENTENCE_BUILDER))
    await screen.findByTestId('renderer-ordering')

    await placeByKeyboard(user, 'w1')
    await placeByKeyboard(user, 'd1')
    expect(idsInAnswer()).toEqual(['w1', 'd1'])
    // A placed token leaves the bank: it is in exactly one of the two zones, never both.
    expect(screen.queryByTestId('draggable-d1')).not.toBeInTheDocument()

    await tabTo(user, byTestId('clear-d1'))
    await user.keyboard('{Enter}')

    expect(idsInAnswer()).toEqual(['w1'])
    expect(screen.getByTestId('draggable-d1')).toBeInTheDocument()
  })

  it('reorders inside the answer without going back through the bank', async () => {
    const user = userEvent.setup()
    renderHost(fixture(SENTENCE_BUILDER))
    await screen.findByTestId('renderer-ordering')

    await placeByKeyboard(user, 'w2')
    await placeByKeyboard(user, 'w1')
    expect(idsInAnswer()).toEqual(['w2', 'w1'])

    const moveUp = await tabTo(user, byTestId('move-up-w1'))
    expect(moveUp).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(idsInAnswer()).toEqual(['w1', 'w2'])

    // A reorder changes the answer as much as a placement does, and nothing else reports it: the
    // row does not move focus, so the live region would still be describing the placement before.
    expect(screen.getByTestId('placement-announcer')).toHaveTextContent(
      '“She” moved to position 1 of 2',
    )
    // Move-up is disabled at the top of the list, which drops focus to `<body>`; the layer takes
    // the first still-enabled control of the pair instead.
    expect(screen.getByTestId('move-down-w1')).toHaveFocus()
  })

  it('announces a token taken back out and returns focus to it in the bank', async () => {
    const user = userEvent.setup()
    renderHost(fixture(SENTENCE_BUILDER))
    await screen.findByTestId('renderer-ordering')

    await placeByKeyboard(user, 'w1')
    await tabTo(user, byTestId('clear-w1'))
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('placement-announcer')).toHaveTextContent(
      '“She” removed from Your answer',
    )
    expect(screen.getByTestId('draggable-w1')).toHaveFocus()
  })

  it('places, reorders and removes with a pointer too', async () => {
    const user = userEvent.setup()
    renderHost(fixture(SENTENCE_BUILDER))
    await screen.findByTestId('renderer-ordering')

    // Tap the token, then the answer area's "place here" button: the same two steps the keyboard
    // takes, which is the point of sharing one select-then-place model. (Dragging a token proper
    // needs real geometry and belongs in Storybook — jsdom reports every rect as 0×0, so no drop
    // target is ever "over".)
    await user.click(screen.getByTestId('draggable-w2'))
    await user.click(await screen.findByTestId('place-answer'))
    await user.click(screen.getByTestId('draggable-w1'))
    await user.click(await screen.findByTestId('place-answer'))
    expect(idsInAnswer()).toEqual(['w2', 'w1'])

    await user.click(screen.getByTestId('move-up-w1'))
    expect(idsInAnswer()).toEqual(['w1', 'w2'])

    await user.click(screen.getByTestId('clear-w2'))
    expect(idsInAnswer()).toEqual(['w1'])
    expect(screen.getByTestId('draggable-w2')).toBeInTheDocument()
  })
})

/** `items[].text` is `RichText`, so a token carries Markdown and `$TeX$` like any other prompt. */
function richOrdering(): Activity {
  const base = sampleOrdering()
  return {
    ...base,
    type: 'sentence_builder',
    payload: {
      family: 'ordering',
      items: [
        { id: 'w1', text: '**She**' },
        { id: 'w2', text: '$H_2O$' },
      ],
      correctOrder: ['w1', 'w2'],
      scoring: 'exact',
      distractors: [{ id: 'd1', text: 'at' }],
    },
  }
}

describe('a token that carries RichText', () => {
  it('renders it in the bank the same way the answer area does, not as source', async () => {
    renderHost(richOrdering())
    await screen.findByTestId('renderer-ordering')

    // Before this, the bank emitted `token.text` as a bare string while the answer area rendered
    // the same field with `<RichText>` — so `**She**` and `$H_2O$` showed as source next to their
    // formatted twins the moment a token was placed.
    expect(screen.getByTestId('draggable-w1').querySelector('strong')).toHaveTextContent('She')
    expect(screen.getByTestId('draggable-w2').querySelector('.katex')).not.toBeNull()
    expect(screen.getByTestId('draggable-w1').textContent).not.toContain('**')
  })

  it('names it as prose in every accessible name and in the live region', async () => {
    const user = userEvent.setup()
    renderHost(richOrdering())
    await screen.findByTestId('renderer-ordering')

    // An `aria-label` is a plain-text attribute and a live region is read out as text, so neither
    // can take the rendered form — and neither may take the source, or a screen reader says
    // "«$H_2O$» picked up".
    expect(screen.getByTestId('draggable-w1')).toHaveAttribute('aria-label', 'She')
    expect(screen.getByTestId('draggable-w2')).toHaveAttribute('aria-label', 'H_2O')

    await tabTo(user, byTestId('draggable-w1'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('placement-announcer')).toHaveTextContent('“She” picked up')

    await tabTo(user, byTestId('place-answer'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('move-up-w1')).toHaveAttribute('aria-label', 'Move up: She')
    expect(screen.getByTestId('clear-w1')).toHaveAttribute('aria-label', 'Remove: She')
  })
})

describe('ordering without distractors', () => {
  it('pre-seeds the shuffled order, so submitting untouched is still a real answer', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(fixture('ordering_sequence/valid-1.json'), onComplete)
    await screen.findByTestId('renderer-ordering')

    // Every item is already in the answer and the bank is not drawn at all: a pure reordering
    // keeps the screen it has always had.
    expect(idsInAnswer()).toHaveLength(4)
    expect(screen.queryByTestId('ordering-bank')).not.toBeInTheDocument()

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.perItem).toHaveLength(4)
  })

  it('sends a removed item to the bank and takes it back', async () => {
    const user = userEvent.setup()
    renderHost(fixture('ordering_sequence/valid-1.json'))
    await screen.findByTestId('renderer-ordering')

    const first = idsInAnswer()[0] as string
    await tabTo(user, byTestId(`clear-${first}`))
    await user.keyboard('{Enter}')

    expect(idsInAnswer()).not.toContain(first)
    expect(screen.getByTestId('ordering-bank')).toBeInTheDocument()

    await placeByKeyboard(user, first)
    // Back at the end of the answer, which is where placing always puts a token.
    expect(idsInAnswer().at(-1)).toBe(first)
  })
})
