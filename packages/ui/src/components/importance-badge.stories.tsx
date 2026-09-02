import type { Meta, StoryObj } from '@storybook/react-vite'
import { IMPORTANCE_LEVELS, ImportanceBadge } from './importance-badge'

const meta = {
  title: 'Components/ImportanceBadge',
  component: ImportanceBadge,
  argTypes: {
    level: { control: 'select', options: IMPORTANCE_LEVELS },
  },
} satisfies Meta<typeof ImportanceBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { level: 'urgent' },
}

export const AllLevels: Story = {
  args: { level: 'urgent' },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {IMPORTANCE_LEVELS.map((level) => (
        <ImportanceBadge key={level} level={level} />
      ))}
    </div>
  ),
}
