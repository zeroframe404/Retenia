import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ChartPoint } from './charts'
import { HistogramChart, SeriesChart } from './charts'

/** A gently decaying `Σ R` series, the shape §13's "memorized knowledge" row produces. */
function decaySeries(days: number): ChartPoint[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.UTC(2026, 5, 15) - (days - 1 - index) * 86_400_000)
    return {
      label: date.toISOString().slice(5, 10),
      // Deterministic so the story does not flicker between renders.
      value: Math.round((320 - index * 0.8 + Math.sin(index / 3) * 14) * 10) / 10,
    }
  })
}

const meta = {
  title: 'Components/Charts',
  component: SeriesChart,
} satisfies Meta<typeof SeriesChart>

export default meta
type Story = StoryObj<typeof meta>

export const MemorizedKnowledge: Story = {
  args: {
    data: decaySeries(30),
    caption: 'Memorized knowledge, last 30 days',
    valueHeading: 'Items recallable',
  },
}

export const Empty: Story = {
  args: { data: [], caption: 'Memorized knowledge', valueHeading: 'Items recallable' },
}

export const StabilityHistogram: StoryObj<typeof HistogramChart> = {
  render: (args) => <HistogramChart {...args} />,
  args: {
    data: [
      { label: '<1d', value: 12 },
      { label: '1–7d', value: 84 },
      { label: '7–21d', value: 140 },
      { label: '21–90d', value: 96 },
      { label: '90d–1y', value: 41 },
      { label: '>1y', value: 9 },
    ],
    caption: 'Cards by stability',
    valueHeading: 'Cards',
  },
}

export const DifficultyHistogram: StoryObj<typeof HistogramChart> = {
  render: (args) => <HistogramChart {...args} />,
  args: {
    data: Array.from({ length: 10 }, (_, index) => ({
      label: `${index + 1}`,
      value: Math.round(120 * Math.exp(-((index - 4) ** 2) / 6)),
    })),
    caption: 'Cards by difficulty',
    valueHeading: 'Cards',
  },
}
