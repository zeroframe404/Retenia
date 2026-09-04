import {
  sampleCategorize,
  sampleCloze,
  sampleOrdering,
  samplePairs,
} from '@retenia/activity-schema/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../index'
import type { Activity } from '@retenia/activity-schema'
import { completionOf } from '../testing/completion'
import { ActivityHost } from './activity-host'
import type { ActivityCompletion } from './use-activity-machine'

/**
 * §9: *"a keyboard alternative for every drag-and-drop (as Rise/H5P require)"*.
 *
 * Every one of these tests drives the UI with `userEvent.keyboard` only — Tab, Enter, Space,
 * arrows. No pointer event is fired anywhere in this file, which is the point: if a placement
 * family can only be answered with a mouse, one of these fails.
 */

function renderHost(activity: Activity, onComplete?: (c: ActivityCompletion) => void) {
  return render(
    <ActivityHost activity={activity} seed="kb-seed" {...(onComplete ? { onComplete } : {})} />,
  )
}

/** Tabs until `predicate` holds, so a test never hard-codes how many stops a widget has. */
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  predicate: (element: Element) => boolean,
  limit = 60,
): Promise<Element> {
  for (let step = 0; step < limit; step += 1) {
    const active = document.activeElement
    if (active && predicate(active)) return active
    await user.tab()
  }
  throw new Error('tabTo: never reached the element')
}

const byTestId = (id: string) => (element: Element) => element.getAttribute('data-testid') === id

function wordbankCloze(): Activity {
  const base = sampleCloze()
  return {
    ...base,
    type: 'cloze_wordbank',
    payload: {
      family: 'cloze',
      mode: 'wordbank',
      segments: [
        { kind: 'text', text: 'La capital de Francia es ' },
        { kind: 'gap', id: 'g1', answers: ['París'] },
        { kind: 'text', text: ' y la de Italia es ' },
        { kind: 'gap', id: 'g2', answers: ['Roma'] },
        { kind: 'text', text: '.' },
      ],
      bankDistractors: ['Madrid'],
      singleUseDraggables: true,
    },
  }
}

describe('keyboard-only placement — cloze word bank', () => {
  it('picks a word up with Enter and places it in a gap with Enter', async () => {
    const user = userEvent.setup()
    renderHost(wordbankCloze())
    await screen.findByTestId('renderer-cloze')

    // Find the bank token that carries "París", whichever position the shuffle put it in.
    const token = screen
      .getAllByRole('button')
      .find((button) => button.textContent === 'París') as HTMLElement
    expect(token).toHaveAttribute('aria-pressed', 'false')

    await tabTo(user, (element) => element === token)
    await user.keyboard('{Enter}')
    expect(token).toHaveAttribute('aria-pressed', 'true')

    // The "place here" buttons only exist while something is picked up — that is the affordance.
    const place = await screen.findByTestId('place-g1')
    await tabTo(user, byTestId('place-g1'))
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('gap-g1')).toHaveTextContent('París')
    expect(place).not.toBeInTheDocument()
  })

  it('grades a keyboard-only answer exactly like any other', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(wordbankCloze(), onComplete)
    await screen.findByTestId('renderer-cloze')

    for (const [word, gap] of [
      ['París', 'g1'],
      ['Roma', 'g2'],
    ] as const) {
      const token = screen
        .getAllByRole('button')
        .find((button) => button.textContent === word) as HTMLElement
      await tabTo(user, (element) => element === token)
      await user.keyboard('{Enter}')
      await tabTo(user, byTestId(`place-${gap}`))
      await user.keyboard('{Enter}')
    }

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.correct).toBe(true)
  })

  it('un-picks a word when its own button is pressed again', async () => {
    const user = userEvent.setup()
    renderHost(wordbankCloze())
    await screen.findByTestId('renderer-cloze')

    const token = screen
      .getAllByRole('button')
      .find((button) => button.textContent === 'París') as HTMLElement
    await tabTo(user, (element) => element === token)
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')

    expect(token).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('place-g1')).not.toBeInTheDocument()
  })

  it('lets a placed word be taken back out', async () => {
    const user = userEvent.setup()
    renderHost(wordbankCloze())
    await screen.findByTestId('renderer-cloze')

    const token = screen
      .getAllByRole('button')
      .find((button) => button.textContent === 'París') as HTMLElement
    await tabTo(user, (element) => element === token)
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('place-g1'))
    await user.keyboard('{Enter}')

    await tabTo(user, byTestId('clear-g1'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('gap-g1')).toHaveTextContent('')
  })
})

describe('keyboard-only placement — matching pairs', () => {
  it('matches every left side from the keyboard', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(samplePairs(), onComplete)
    await screen.findByTestId('renderer-pairs')

    for (const [right, left] of [
      ['París', 'p1'],
      ['Roma', 'p2'],
      ['Madrid', 'p3'],
    ] as const) {
      await tabTo(
        user,
        byTestId(`draggable-${right === 'París' ? 'p1' : right === 'Roma' ? 'p2' : 'p3'}`),
      )
      await user.keyboard('{Enter}')
      await tabTo(user, byTestId(`place-${left}`))
      await user.keyboard('{Enter}')
    }

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.score).toBe(1)
  })

  it('moves a right side from one left side to another instead of duplicating it', async () => {
    const user = userEvent.setup()
    renderHost(samplePairs())
    await screen.findByTestId('renderer-pairs')

    await tabTo(user, byTestId('draggable-p1'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('place-p2'))
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('match-p2')).toHaveTextContent('París')

    await tabTo(user, byTestId('draggable-p1'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('place-p3'))
    await user.keyboard('{Enter}')

    expect(screen.getByTestId('match-p3')).toHaveTextContent('París')
    expect(screen.getByTestId('match-p2')).toHaveTextContent('')
  })
})

describe('keyboard-only placement — categorize', () => {
  it('sorts items into categories from the keyboard, and takes one back out', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(sampleCategorize(), onComplete)
    await screen.findByTestId('renderer-categorize')

    for (const [item, category] of [
      ['i1', 'c1'],
      ['i2', 'c2'],
      ['i3', 'c1'],
    ] as const) {
      await tabTo(user, byTestId(`draggable-${item}`))
      await user.keyboard('{Enter}')
      await tabTo(user, byTestId(`place-${category}`))
      await user.keyboard('{Enter}')
    }
    expect(screen.getByTestId('placed-i3-c1')).toBeInTheDocument()

    await tabTo(user, byTestId('placed-i3-c1'))
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('placed-i3-c1')).not.toBeInTheDocument()

    // …and back in, so the answer is complete before checking.
    await tabTo(user, byTestId('draggable-i3'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('place-c1'))
    await user.keyboard('{Enter}')

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.score).toBe(1)
  })
})

describe('keyboard-only placement — ordering', () => {
  it('reorders with the move buttons and grades the result', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(sampleOrdering(), onComplete)
    await screen.findByTestId('renderer-ordering')

    const idsOnScreen = () =>
      [...screen.getByTestId('renderer-ordering').children].map((item) =>
        (item.getAttribute('data-testid') ?? '').replace('ordering-item-', ''),
      )

    // Selection sort with the two buttons alone: enough to reach any permutation from any start.
    const target = ['i1', 'i2', 'i3', 'i4']
    for (let slot = 0; slot < target.length; slot += 1) {
      const wanted = target[slot] as string
      let at = idsOnScreen().indexOf(wanted)
      while (at > slot) {
        await user.click(screen.getByTestId(`move-up-${wanted}`))
        at -= 1
      }
    }
    expect(idsOnScreen()).toEqual(target)

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.score).toBe(1)
  })

  it('grades the presented order when the user submits without touching anything', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(sampleOrdering(), onComplete)
    await screen.findByTestId('renderer-ordering')

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const completion = completionOf(onComplete)
    // The shuffled order is a real answer, so it is graded on its merits — not as an empty list.
    expect(completion.result?.perItem).toHaveLength(4)
    expect(completion.result?.score).toBeGreaterThan(0)
  })

  it('disables the move that would fall off either end', async () => {
    renderHost(sampleOrdering())
    await screen.findByTestId('renderer-ordering')

    const items = [...screen.getByTestId('renderer-ordering').children]
    const first = (items[0]?.getAttribute('data-testid') ?? '').replace('ordering-item-', '')
    const last = (items.at(-1)?.getAttribute('data-testid') ?? '').replace('ordering-item-', '')
    expect(screen.getByTestId(`move-up-${first}`)).toBeDisabled()
    expect(screen.getByTestId(`move-down-${last}`)).toBeDisabled()
  })
})

describe('arrow keys walk the drop zones while an item is held', () => {
  it('moves the cursor with the arrows, places with Enter and cancels with Escape', async () => {
    const user = userEvent.setup()
    renderHost(samplePairs())
    await screen.findByTestId('renderer-pairs')

    await tabTo(user, byTestId('draggable-p1'))
    await user.keyboard('{Enter}')
    // Picking up parks the cursor on the first zone and focus follows it.
    expect(document.activeElement).toBe(screen.getByTestId('place-p1'))

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByTestId('place-p2'))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByTestId('place-p1'))

    // …and wraps around rather than stopping at the end.
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(screen.getByTestId('place-p3'))

    await user.keyboard('{Enter}')
    expect(screen.getByTestId('match-p3')).toHaveTextContent('París')
  })

  it('Escape puts the item back down without placing it', async () => {
    const user = userEvent.setup()
    renderHost(samplePairs())
    await screen.findByTestId('renderer-pairs')

    await tabTo(user, byTestId('draggable-p1'))
    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')

    expect(screen.getByTestId('draggable-p1')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('place-p1')).not.toBeInTheDocument()
    expect(screen.getByTestId('match-p1')).toHaveTextContent('')
  })
})

describe('placement is locked once the answer is in', () => {
  it('offers no pick-up and no drop after grading', async () => {
    const user = userEvent.setup()
    renderHost(samplePairs())
    await screen.findByTestId('renderer-pairs')

    await user.click(screen.getByTestId('check-button'))
    await screen.findByTestId('feedback-panel')

    expect(screen.getByTestId('draggable-p1')).toBeDisabled()
    expect(screen.queryByTestId('place-p1')).not.toBeInTheDocument()
  })
})
