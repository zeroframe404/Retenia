import type { Activity } from '@retenia/activity-schema'
import { sampleCards, sampleChoice, sampleTextInput } from '@retenia/activity-schema/testing'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../index'
import { completionOf } from '../testing/completion'
import { ActivityHost } from './activity-host'
import type { ActivityCompletion } from './use-activity-machine'

/**
 * `choice`, `cards` and `text_input` need no `DragLayer` alternative — every control is a native
 * radio, checkbox, button or text field, keyboard-operable for free — but the acceptance criterion
 * of this sub-phase is still "every renderer passes the keyboard-only interaction test", so this
 * drives each one with `userEvent.keyboard`/`.tab()` alone, exactly like
 * `keyboard-placement.test.tsx` does for the drag-and-drop families.
 */

function renderHost(activity: Activity, onComplete?: (c: ActivityCompletion) => void) {
  return render(
    <ActivityHost activity={activity} seed="kb-answer" {...(onComplete ? { onComplete } : {})} />,
  )
}

async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  predicate: (element: Element) => boolean,
  limit = 40,
): Promise<Element> {
  for (let step = 0; step < limit; step += 1) {
    const active = document.activeElement
    if (active && predicate(active)) return active
    await user.tab()
  }
  throw new Error('tabTo: never reached the element')
}

const byTestId = (id: string) => (element: Element) => element.getAttribute('data-testid') === id

describe('keyboard-only answering — choice', () => {
  it('reaches a radio group with Tab, picks with the arrow keys, checks with Enter', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(sampleChoice(), onComplete)
    await screen.findByTestId('renderer-choice')

    // Options are shuffled by seed, and a native radio group is one Tab stop when none is
    // checked: Tab lands on whichever option the shuffle put first, then the arrow keys — which
    // also *select* as they move, per native radio semantics — walk to the correct one.
    const optionA = screen.getByTestId('option-a')
    const isRadio = (element: Element) =>
      (element.getAttribute('data-testid') ?? '').startsWith('option-')
    await tabTo(user, isRadio)
    for (let step = 0; step < 3 && document.activeElement !== optionA; step += 1) {
      await user.keyboard('{ArrowDown}')
    }
    expect(document.activeElement).toBe(optionA)
    expect(optionA).toBeChecked()

    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.correct).toBe(true)
  })
})

describe('keyboard-only answering — cards', () => {
  it('reveals the back and self-grades, both with Enter', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost(sampleCards(), onComplete)
    await screen.findByTestId('renderer-cards')

    await tabTo(user, byTestId('reveal-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('grade-4'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.rating).toBe(4)
  })

  it('reaches the dialog_cards two-button variant the same way', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn<(completion: ActivityCompletion) => void>()
    renderHost({ ...sampleCards(), type: 'dialog_cards' }, onComplete)
    await screen.findByTestId('renderer-cards')

    await tabTo(user, byTestId('reveal-button'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('grade-1'))
    await user.keyboard('{Enter}')
    await tabTo(user, byTestId('continue-button'))
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(completionOf(onComplete).result?.rating).toBe(1)
  })
})

describe('keyboard-only answering — text input', () => {
  it('types the answer and submits, all from the keyboard', async () => {
    const user = userEvent.setup()
    renderHost(sampleTextInput())
    await screen.findByTestId('renderer-text_input')

    await tabTo(user, byTestId('text-input'))
    await user.keyboard('Paris')
    await tabTo(user, byTestId('check-button'))
    await user.keyboard('{Enter}')

    expect(await screen.findByTestId('feedback-panel')).toHaveAttribute('data-tone', 'correct')
  })
})
