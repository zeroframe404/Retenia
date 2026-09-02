import type { Meta, StoryObj } from '@storybook/react-vite'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

const meta = {
  title: 'Components/Select',
  component: Select,
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Select defaultValue="normal">
      <SelectTrigger className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="urgent">Urgent</SelectItem>
        <SelectItem value="high">High</SelectItem>
        <SelectItem value="normal">Normal</SelectItem>
        <SelectItem value="maintenance">Maintenance</SelectItem>
        <SelectItem value="paused">Paused</SelectItem>
      </SelectContent>
    </Select>
  ),
}
