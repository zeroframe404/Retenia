import type { Meta, StoryObj } from '@storybook/react-vite'
import { BarChart3Icon, BookOpenIcon, HomeIcon, RouteIcon } from 'lucide-react'
import { useState } from 'react'
import { Sidebar } from './sidebar'

const meta = {
  title: 'Components/Sidebar',
  component: Sidebar,
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

const items = [
  { id: 'home', label: 'Hoy', icon: HomeIcon, active: true },
  { id: 'path', label: 'Camino', icon: RouteIcon },
  { id: 'review', label: 'Repasar', icon: BookOpenIcon, badge: 12 },
  { id: 'statistics', label: 'Estadísticas', icon: BarChart3Icon },
]

export const Expanded: Story = {
  args: {
    items,
    collapsed: false,
    onToggleCollapsed: () => {},
    onSelect: () => {},
    collapseLabel: 'Collapse sidebar',
    expandLabel: 'Expand sidebar',
  },
  render: (args) => {
    function Demo() {
      const [collapsed, setCollapsed] = useState(args.collapsed)
      return (
        <div className="h-96">
          <Sidebar
            {...args}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((c) => !c)}
          />
        </div>
      )
    }
    return <Demo />
  },
}

export const Collapsed: Story = {
  args: {
    ...Expanded.args,
    collapsed: true,
  },
  render: (args) => (
    <div className="h-96">
      <Sidebar {...args} />
    </div>
  ),
}
