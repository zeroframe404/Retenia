import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { RetentionLevelRow } from './retention-level-row'

// An explicit annotation, not `satisfies Meta`: see `components/card-view.stories.tsx`'s
// comment.
const meta: Meta<typeof RetentionLevelRow> = {
  title: 'Scheduler/RetentionLevelRow',
  component: RetentionLevelRow,
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

/** Drag it: the cost under the slider re-simulates on every frame, because §6's simulator
 *  is pure TypeScript in `@retenia/core` rather than a call into the optimizer's binding. */
function Interactive({
  level,
  initial,
}: {
  level: Parameters<typeof RetentionLevelRow>[0]['level']
  initial: number
}) {
  const [retention, setRetention] = useState(initial)
  return (
    <RetentionLevelRow level={level} retention={retention} w={undefined} onChange={setRetention} />
  )
}

/** The default: §7's 0.90, the baseline every other level's cost is quoted against. */
export const Normal: Story = {
  render: () => <Interactive level="normal" initial={0.9} />,
}

/** §7's headline example — "Urgente costará ≈ 2.5× repasos" — at the 0.95 the level asks
 *  for. The simulated figure is lower than that table's, and deliberately so: the table is
 *  a per-card ratio at fixed stability, this is what the user's deck actually costs. */
export const Urgent: Story = {
  render: () => <Interactive level="urgent" initial={0.95} />,
}

/** The floor of §7's maintenance band: "so it is not lost, without loading the day". */
export const Maintenance: Story = {
  render: () => <Interactive level="maintenance" initial={0.85} />,
}

/** The ceiling §6 warns about: above 0.97 spaced repetition turns into massed repetition. */
export const UrgentCeiling: Story = {
  render: () => <Interactive level="urgent" initial={0.97} />,
}
