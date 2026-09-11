import type { Meta, StoryObj } from '@storybook/react-vite'
import { QaBadges, type QaBadgesLabels } from './qa-badges'

const labels: QaBadgesLabels = {
  fidelity: (percent) => `${percent} % fiel`,
  sources: (count) => (count === 1 ? '1 fuente' : `${count} fuentes`),
  reviewed: 'Revisado',
  review: 'Revisar',
  unreviewed: 'Sin revisar',
}

const meta = {
  title: 'Components/QaBadges',
  component: QaBadges,
  args: { labels, faithfulness: 0.96, sourcesCount: 3, verdict: 'pass', reviewed: true },
} satisfies Meta<typeof QaBadges>

export default meta
type Story = StoryObj<typeof meta>

export const Passed: Story = {}

export const Edited: Story = {
  args: { faithfulness: 0.82, sourcesCount: 2, verdict: 'fixed' },
}

export const Flagged: Story = {
  args: { faithfulness: 0.55, sourcesCount: 1, verdict: 'flagged' },
}

export const Unreviewed: Story = {
  args: { faithfulness: null, sourcesCount: 0, verdict: 'flagged', reviewed: false },
}

/** §5 gate 3's three bands, side by side: ≥ 0.9 passed, 0.7–0.9 edited, < 0.7 regenerated. */
export const Bands: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <QaBadges {...args} faithfulness={1} sourcesCount={4} verdict="pass" />
      <QaBadges {...args} faithfulness={0.8} sourcesCount={2} verdict="fixed" />
      <QaBadges {...args} faithfulness={0.65} sourcesCount={1} verdict="regenerated" />
      <QaBadges {...args} faithfulness={0.4} sourcesCount={1} verdict="flagged" />
    </div>
  ),
}
