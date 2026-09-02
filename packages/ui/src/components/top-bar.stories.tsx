import type { Meta, StoryObj } from '@storybook/react-vite'
import { TopBar } from './top-bar'

const meta = {
  title: 'Components/TopBar',
  component: TopBar,
} satisfies Meta<typeof TopBar>

export default meta
type Story = StoryObj<typeof meta>

export const Arcade: Story = {
  args: {
    breadcrumbs: [{ label: 'Retenia' }, { label: 'Camino' }, { label: 'Lección 7' }],
    onSearchClick: () => {},
    searchLabel: 'Search',
    xpLabel: '1,240 XP',
  },
}

export const Sober: Story = {
  args: {
    ...Arcade.args,
    xpHidden: true,
  },
}
