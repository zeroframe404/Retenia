import type { Meta, StoryObj } from '@storybook/react-vite'
import type { HeatmapPoint } from './heatmap'
import { Heatmap } from './heatmap'

function seedData(days: number): HeatmapPoint[] {
  const points: HeatmapPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10)
    // Deterministic pseudo-random pattern so the story is stable across renders.
    const value = Math.round(Math.abs(Math.sin(i * 1.7)) * 40)
    points.push({ date, value })
  }
  return points
}

const meta = {
  title: 'Components/Heatmap',
  component: Heatmap,
} satisfies Meta<typeof Heatmap>

export default meta
type Story = StoryObj<typeof meta>

export const TwelveWeeks: Story = {
  args: { data: seedData(84), weeks: 12, caption: 'Reviews per day, last 12 weeks' },
}

export const TwentySixWeeks: Story = {
  args: { data: seedData(182), weeks: 26, caption: 'Reviews per day, last 26 weeks' },
}

export const FiftyTwoWeeks: Story = {
  args: { data: seedData(365), weeks: 52, caption: 'Reviews per day, last 52 weeks' },
}
