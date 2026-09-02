import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { toast } from './toast'

const meta = {
  title: 'Components/Toast',
  render: () => (
    <div className="flex gap-3">
      <Button onClick={() => toast('Streak saved for today.')}>Show toast</Button>
      <Button variant="outline" onClick={() => toast.error('Could not save — offline.')}>
        Show error
      </Button>
    </div>
  ),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
