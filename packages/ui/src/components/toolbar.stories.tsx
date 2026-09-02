import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoldIcon, ItalicIcon, UnderlineIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import { IconButton } from './button'
import { Toolbar } from './toolbar'

const meta = {
  title: 'Components/Toolbar',
  component: Toolbar,
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

export const Editor: Story = {
  args: {
    start: (
      <>
        <IconButton variant="ghost" size="sm" aria-label="Bold">
          <BoldIcon />
        </IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Italic">
          <ItalicIcon />
        </IconButton>
        <IconButton variant="ghost" size="sm" aria-label="Underline">
          <UnderlineIcon />
        </IconButton>
      </>
    ),
    end: (
      <>
        <IconButton variant="ghost" size="sm" aria-label="Zoom out">
          <ZoomOutIcon />
        </IconButton>
        <span className="text-muted text-sm">120%</span>
        <IconButton variant="ghost" size="sm" aria-label="Zoom in">
          <ZoomInIcon />
        </IconButton>
      </>
    ),
  },
}

export const WithCenterGroup: Story = {
  args: {
    start: (
      <IconButton variant="ghost" size="sm" aria-label="Zoom out">
        <ZoomOutIcon />
      </IconButton>
    ),
    children: <span className="text-text text-sm font-medium">Page 4 of 128</span>,
    end: (
      <IconButton variant="ghost" size="sm" aria-label="Zoom in">
        <ZoomInIcon />
      </IconButton>
    ),
  },
}
