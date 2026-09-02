import type { Meta, StoryObj } from '@storybook/react-vite'
import { InfoIcon } from 'lucide-react'
import { IconButton } from './button'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<IconButton variant="ghost" aria-label="Why today?" />}>
        <InfoIcon />
      </TooltipTrigger>
      <TooltipContent>Stability 4.2d · Retrievability 71%</TooltipContent>
    </Tooltip>
  ),
}
