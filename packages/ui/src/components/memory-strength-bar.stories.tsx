import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryStrengthBar } from './memory-strength-bar'

const meta = {
  title: 'Components/MemoryStrengthBar',
  component: MemoryStrengthBar,
  argTypes: {
    retrievability: { control: { type: 'range', min: 0, max: 1, step: 0.01 } },
  },
} satisfies Meta<typeof MemoryStrengthBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { retrievability: 0.71 },
}

export const AllBands: Story = {
  args: { retrievability: 0.71 },
  render: () => (
    <div className="flex w-64 flex-col gap-3">
      <MemoryStrengthBar retrievability={0.12} />
      <MemoryStrengthBar retrievability={0.45} />
      <MemoryStrengthBar retrievability={0.71} />
      <MemoryStrengthBar retrievability={0.95} />
    </div>
  ),
}

/** docs/spec/08-ux.md §1.3 in full: strength (R), stability (S) and why it appeared today,
 * with the band word translated the way the app would pass it. */
export const Transparent: Story = {
  args: { retrievability: 0.71 },
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <MemoryStrengthBar
        retrievability={0.42}
        stability={0.6}
        dueReason="Vence hoy · falló 2 veces seguidas"
        bandLabels={{ critical: 'Crítica', weak: 'Débil', good: 'Buena', strong: 'Fuerte' }}
      />
      <MemoryStrengthBar
        retrievability={0.88}
        stability={64}
        dueReason="Adelantada por el examen del 14"
        bandLabels={{ critical: 'Crítica', weak: 'Débil', good: 'Buena', strong: 'Fuerte' }}
      />
    </div>
  ),
}
