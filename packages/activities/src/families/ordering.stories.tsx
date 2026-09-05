import type { Activity } from '@retenia/activity-schema'
import { sampleOrdering } from '@retenia/activity-schema/testing/samples'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import '../index'
import { ActivityHost } from '../host/activity-host'
import { activityCatalog } from '../testing/catalog'

/**
 * The `ordering` family's two shapes (`docs/spec/03-activities.md` §7).
 *
 * The distinction the stories exist to show is the one the renderer has to take a decision about:
 * **with distractors** the answer area starts empty and the learner chooses which tokens belong —
 * only the placed ids are submitted, which is what makes `scoring: 'exact'` winnable at all;
 * **without them** every item is pre-seeded in the shuffled order and the learner only reorders.
 *
 * This is also where a human checks the one thing no unit test can: *dragging* a token, which needs
 * real geometry that jsdom does not have. The token now follows the pointer — `DraggableItem`
 * applies dnd-kit's `transform` to itself — so a drag that moves nothing is a regression, not the
 * expected behaviour. The play functions below drive the tap-to-place half, which is the same
 * select-then-place model the keyboard uses.
 */

function fixture(id: string): Activity {
  const entry = activityCatalog().find((candidate) => candidate.id === id)
  if (entry === undefined) throw new Error(`${id} is not in the fixture catalogue`)
  return entry.activity
}

const meta = {
  title: 'Activities/Ordering',
  component: ActivityHost,
  args: { seed: 'storybook', mode: 'study', activity: sampleOrdering() },
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

/** `ordering_sequence`: no distractors, so the list arrives pre-seeded and the bank stays hidden. */
export const Reordering: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-ordering')
    await expect(canvas.getByTestId('ordering-answer').children).toHaveLength(4)
    await expect(canvas.queryByTestId('ordering-bank')).not.toBeInTheDocument()
  },
}

/** `sentence_builder`: four words, two distractors, and an answer the learner builds from nothing. */
export const BuildingASentence: Story = {
  args: { activity: fixture('sentence_builder/valid-1.json') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-ordering')
    await expect(canvas.getByTestId('ordering-answer').children).toHaveLength(0)

    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      await userEvent.click(canvas.getByTestId(`draggable-${id}`))
      await userEvent.click(await canvas.findByTestId('place-answer'))
    }

    // The distractors are still in the bank, and therefore still out of the response.
    await expect(canvas.getByTestId('draggable-d1')).toBeInTheDocument()
    await userEvent.click(canvas.getByTestId('check-button'))
    await expect(await canvas.findByTestId('feedback-panel')).toHaveAttribute(
      'data-tone',
      'correct',
    )
  },
}

/**
 * `items[].text` is `RichText`, so a token can carry Markdown and `$TeX$` — a `parsons_problem`
 * line or a chemistry `timeline_build` hits this on the first token. The bank and the answer area
 * have to draw it the same way; the source is only ever used for the accessible names.
 */
export const RichTokens: Story = {
  args: {
    activity: {
      ...sampleOrdering(),
      type: 'sentence_builder',
      payload: {
        family: 'ordering',
        items: [
          { id: 'w1', text: '**She**' },
          { id: 'w2', text: 'drinks' },
          { id: 'w3', text: '$H_2O$' },
        ],
        correctOrder: ['w1', 'w2', 'w3'],
        scoring: 'exact',
        distractors: [{ id: 'd1', text: '*at*' }],
      },
    } satisfies Activity,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-ordering')

    await expect(canvas.getByTestId('draggable-w1').querySelector('strong')).toBeInTheDocument()
    await expect(canvas.getByTestId('draggable-w3').querySelector('.katex')).toBeInTheDocument()
    // The name is prose, not source: it is what a screen reader reads out of the live region.
    await expect(canvas.getByTestId('draggable-w1')).toHaveAttribute('aria-label', 'She')
  },
}

/** A token placed by mistake goes back to the bank rather than costing the learner the answer. */
export const TakingATokenBack: Story = {
  args: { activity: fixture('sentence_builder/valid-1.json') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByTestId('renderer-ordering')

    await userEvent.click(canvas.getByTestId('draggable-d1'))
    await userEvent.click(await canvas.findByTestId('place-answer'))
    await expect(canvas.getByTestId('ordering-item-d1')).toBeInTheDocument()

    await userEvent.click(canvas.getByTestId('clear-d1'))
    await expect(canvas.queryByTestId('ordering-item-d1')).not.toBeInTheDocument()
    await expect(canvas.getByTestId('draggable-d1')).toBeInTheDocument()
  },
}
