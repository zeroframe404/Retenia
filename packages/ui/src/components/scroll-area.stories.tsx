import type { Meta, StoryObj } from '@storybook/react-vite'
import { ScrollArea } from './scroll-area'

const meta = {
  title: 'Components/ScrollArea',
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ScrollArea className="border-border h-48 w-64 rounded-md border">
      <div className="flex flex-col gap-2 p-4 text-sm">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((lesson) => (
          <p key={lesson}>Lesson {lesson}: review item</p>
        ))}
      </div>
    </ScrollArea>
  ),
}
