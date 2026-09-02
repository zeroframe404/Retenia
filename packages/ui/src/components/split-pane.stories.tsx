import type { Meta, StoryObj } from '@storybook/react-vite'
import { SplitPane } from './split-pane'

const meta = {
  title: 'Components/SplitPane',
  component: SplitPane,
} satisfies Meta<typeof SplitPane>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  args: {
    'aria-label': 'Resize source/notes split',
    start: <div className="bg-neutral-100 dark:bg-neutral-800 h-full p-4">Source</div>,
    end: <div className="p-4">Notes</div>,
  },
  render: (args) => (
    <div className="h-80 w-full">
      <SplitPane {...args} />
    </div>
  ),
}

export const Vertical: Story = {
  args: {
    'aria-label': 'Resize preview/console split',
    direction: 'vertical',
    defaultSize: 65,
    start: <div className="bg-neutral-100 dark:bg-neutral-800 h-full p-4">Preview</div>,
    end: <div className="p-4">Console</div>,
  },
  render: (args) => (
    <div className="h-80 w-full">
      <SplitPane {...args} />
    </div>
  ),
}
