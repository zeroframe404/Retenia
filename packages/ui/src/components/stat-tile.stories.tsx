import type { Meta, StoryObj } from '@storybook/react-vite'
import { StatTile } from './stat-tile'

const meta = {
  title: 'Components/StatTile',
  component: StatTile,
} satisfies Meta<typeof StatTile>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { value: '1,240', label: 'XP this week' },
}

export const TrendingUp: Story = {
  args: { value: '87%', label: 'Retention (30d)', delta: 4.2 },
}

export const TrendingDown: Story = {
  args: { value: '32', label: 'Cards overdue', delta: -8 },
}

export const Flat: Story = {
  args: { value: '6', label: 'Day streak', delta: 0 },
}

export const WithSparkline: Story = {
  args: {
    value: '1,240',
    label: 'XP this week',
    delta: 12,
    sparkline: (
      <svg viewBox="0 0 100 24" className="text-brand-500 h-6 w-full" aria-hidden="true">
        <polyline
          points="0,18 15,14 30,16 45,8 60,10 75,4 100,6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
}

export const Grid: Story = {
  args: { value: '1,240', label: 'XP this week' },
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      <StatTile value="1,240" label="XP this week" delta={12} />
      <StatTile value="87%" label="Retention (30d)" delta={4.2} />
      <StatTile value="32" label="Cards overdue" delta={-8} />
    </div>
  ),
}
