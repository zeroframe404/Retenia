import type { Activity, GradeResult } from '@retenia/activity-schema'
import {
  sampleCards,
  sampleChoice,
  sampleCloze,
  sampleDisclosure,
  sampleLongText,
  sampleOrdering,
  samplePairs,
  sampleTextInput,
} from '@retenia/activity-schema/testing/samples'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import '../index'
import { ActivityHost } from './activity-host'
import type { GradePort } from './ports'

/**
 * One story per state of the `<ActivityHost/>` machine (`docs/spec/03-activities.md` §9), driven
 * through the real UI by each story's `play` — so the catalogue documents the states *and* checks
 * that they are still reachable.
 */

function hinted(): Activity {
  const activity = sampleChoice()
  return {
    ...activity,
    hints: ['Está sobre el Sena.', 'Empieza con P.'],
    explanation: 'París es la capital de Francia desde 987.',
    grading: { ...activity.grading, hintPenalty: 0.25, maxAttempts: 2 },
  }
}

/** A grader that never settles, so the `checking` state stays on screen. */
const neverSettles: GradePort = () => new Promise<GradeResult>(() => {})

const meta = {
  title: 'Activities/ActivityHost',
  component: ActivityHost,
  args: { seed: 'storybook', mode: 'study' },
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ActivityHost>

export default meta
type Story = StoryObj<typeof meta>

/** `presenting`: mounted, timer running, nothing answered. */
export const Presenting: Story = {
  args: { activity: sampleChoice() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-choice')
    await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'presenting')
  },
}

/** `answering`: the user has picked an option. */
export const Answering: Story = {
  args: { activity: sampleChoice() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('option-b'))
    await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'answering')
  },
}

/** `hinting`: a hint is open and the score is already discounted. */
export const Hinting: Story = {
  args: { activity: hinted() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('hint-button'))
    await expect(canvas.getByTestId('hint-list')).toBeVisible()
    await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'hinting')
  },
}

/** `checking`: the answer is with the grader — the state an AI rubric sits in for a few seconds. */
export const Checking: Story = {
  args: { activity: sampleChoice(), grade: neverSettles },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('option-a'))
    await userEvent.click(canvas.getByTestId('check-button'))
    await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'checking')
    await expect(canvas.getByTestId('check-button')).toBeDisabled()
  },
}

/** `feedback`, correct: the panel is only ever rendered from a `GradeResult`. */
export const FeedbackCorrect: Story = {
  args: { activity: hinted() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('option-a'))
    await userEvent.click(canvas.getByTestId('check-button'))
    const panel = await canvas.findByTestId('feedback-panel')
    await expect(panel).toHaveAttribute('data-tone', 'correct')
    await expect(canvas.queryByTestId('retry-button')).not.toBeInTheDocument()
  },
}

/** `feedback`, wrong, with an attempt left: the retry edge back to `answering`. */
export const FeedbackRetry: Story = {
  args: { activity: hinted() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('option-c'))
    await userEvent.click(canvas.getByTestId('check-button'))
    const panel = await canvas.findByTestId('feedback-panel')
    await expect(panel).toHaveAttribute('data-tone', 'incorrect')
    await expect(canvas.getByTestId('retry-button')).toBeEnabled()
  },
}

/** The "Explain" button of §9, answered here by the activity's own static explanation. */
export const Explained: Story = {
  args: { activity: hinted() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('option-a'))
    await userEvent.click(canvas.getByTestId('check-button'))
    await userEvent.click(await canvas.findByTestId('explain-button'))
    await expect(await canvas.findByTestId('explanation')).toBeVisible()
  },
}

/** `completed`, reached by skipping: the run ends with no grade at all. */
export const Skipped: Story = {
  args: { activity: sampleChoice() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('skip-button'))
    await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'completed')
  },
}

/** `test` mode: timer on screen, no hints, feedback deferred to the end of the exam. */
export const TestMode: Story = {
  args: { activity: hinted(), mode: 'test' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-choice')
    await expect(canvas.getByTestId('activity-timer')).toBeVisible()
    await expect(canvas.queryByTestId('hint-button')).not.toBeInTheDocument()

    await userEvent.click(canvas.getByTestId('option-a'))
    await userEvent.click(canvas.getByTestId('check-button'))
    await waitFor(async () => {
      await expect(canvas.getByTestId('activity-host')).toHaveAttribute('data-status', 'completed')
    })
    await expect(canvas.queryByTestId('feedback-panel')).not.toBeInTheDocument()
  },
}

/** `grading.timeLimitSec`: the countdown that auto-submits (§7). */
export const TimeLimited: Story = {
  args: {
    activity: (() => {
      const activity = sampleChoice()
      return { ...activity, grading: { ...activity.grading, timeLimitSec: 45 } }
    })(),
  },
}

/** A type whose family has no renderer yet: the host says so instead of crashing. */
export const UnsupportedType: Story = {
  args: { activity: { ...sampleChoice(), type: 'odd_one_out' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByTestId('unsupported-type')).toBeVisible()
  },
}

/**
 * §9's keyboard rule, as an interaction test: a word bank answered with **no pointer events at
 * all** — Tab to the word, Enter to pick it up, the arrow keys to walk the gaps, Enter to drop it.
 */
export const KeyboardOnlyDragAndDrop: Story = {
  args: {
    activity: {
      ...sampleCloze(),
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
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-cloze')

    for (const [word, gap] of [
      ['París', 'g1'],
      ['Roma', 'g2'],
    ] as const) {
      const token = canvas
        .getAllByRole('button')
        .find((button) => button.textContent === word) as HTMLElement

      // Tab until the word has focus — no `click`, no `focus()`: only keys a user can press.
      for (let step = 0; step < 40 && document.activeElement !== token; step += 1) {
        await userEvent.tab()
      }
      await expect(token).toHaveFocus()
      await userEvent.keyboard('{Enter}')
      await expect(token).toHaveAttribute('aria-pressed', 'true')

      // Picking up parks the cursor on the first gap; the arrows walk to the one we want.
      while (document.activeElement !== canvas.getByTestId(`place-${gap}`)) {
        await userEvent.keyboard('{ArrowDown}')
      }
      await userEvent.keyboard('{Enter}')
      await expect(canvas.getByTestId(`gap-${gap}`)).toHaveTextContent(word)
    }

    for (
      let step = 0;
      step < 40 && document.activeElement !== canvas.getByTestId('check-button');
      step += 1
    ) {
      await userEvent.tab()
    }
    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByTestId('feedback-panel')).toHaveAttribute(
      'data-tone',
      'correct',
    )
  },
}

/** `dialog_cards` (§4 row 3): the same M-self grader, a two-button "I knew it / no" variant. */
export const DialogCardsSelfRating: Story = {
  args: {
    activity: {
      ...sampleCards(),
      type: 'dialog_cards',
      payload: { ...sampleCards().payload, presentation: 'dialog' },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByTestId('reveal-button'))
    await expect(canvas.queryByTestId('grade-2')).not.toBeInTheDocument()

    await userEvent.click(canvas.getByTestId('grade-3'))
    const panel = await canvas.findByTestId('feedback-panel')
    await expect(panel).toHaveAttribute('data-tone', 'correct')
  },
}

/** §4 row 5: a `short_answer` near miss shows a character-level diff, not just the model answer. */
export const NearMissDiff: Story = {
  args: { activity: sampleTextInput() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByTestId('text-input')
    // Two substitutions against "París": over the FUZ tolerance, but still worth showing the diff.
    await userEvent.type(input, 'Parxz')
    await userEvent.click(canvas.getByTestId('check-button'))

    const panel = await canvas.findByTestId('feedback-panel')
    await expect(panel).toHaveAttribute('data-tone', 'partial')
    await expect(canvas.getByTestId('answer-diff')).toBeVisible()
  },
}

/** The other MVP families, at rest, so the catalogue shows what each one looks like. */
export const Flashcard: Story = { args: { activity: sampleCards() } }
export const MatchingPairs: Story = { args: { activity: samplePairs() } }
export const Ordering: Story = { args: { activity: sampleOrdering() } }
export const LongText: Story = { args: { activity: sampleLongText() } }
export const TheoryBlock: Story = { args: { activity: sampleDisclosure() } }
