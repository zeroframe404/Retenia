import type { Meta, StoryObj } from '@storybook/react-vite'
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from './tabs'

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tabs defaultValue="due" className="w-96">
      <TabsList>
        <TabsTab value="due">Due</TabsTab>
        <TabsTab value="new">New</TabsTab>
        <TabsTab value="all">All</TabsTab>
        <TabsIndicator />
      </TabsList>
      <TabsPanel value="due" className="pt-4 text-sm">
        35 cards due, ~12 minutes.
      </TabsPanel>
      <TabsPanel value="new" className="pt-4 text-sm">
        6 new cards ready to learn.
      </TabsPanel>
      <TabsPanel value="all" className="pt-4 text-sm">
        128 cards total.
      </TabsPanel>
    </Tabs>
  ),
}
