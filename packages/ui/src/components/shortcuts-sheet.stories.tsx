import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SHORTCUTS } from '../shortcuts'
import { Button } from './button'
import { ShortcutsSheet } from './shortcuts-sheet'

const LABELS: Record<string, string> = {
  'shortcuts.title': 'Keyboard shortcuts',
  'shortcuts.scopeGlobal': 'Global',
  'shortcuts.scopeReview': 'Review',
  'shortcuts.commandPalette': 'Open the command palette',
  'shortcuts.openSettings': 'Open settings',
  'shortcuts.shortcutsSheet': 'Show this shortcut list',
  'shortcuts.reveal': 'Reveal the answer',
  'shortcuts.continue': 'Continue',
  'shortcuts.back': 'Back',
  'shortcuts.grade1': 'Grade: again',
  'shortcuts.grade2': 'Grade: hard',
  'shortcuts.grade3': 'Grade: good',
  'shortcuts.grade4': 'Grade: easy',
}

const meta = {
  title: 'Components/ShortcutsSheet',
  component: ShortcutsSheet,
} satisfies Meta<typeof ShortcutsSheet>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    shortcuts: SHORTCUTS,
    translate: (key: string) => LABELS[key] ?? key,
  },
  render: (args) => {
    function Demo() {
      const [open, setOpen] = useState(args.open)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open shortcuts</Button>
          <ShortcutsSheet {...args} open={open} onOpenChange={setOpen} />
        </>
      )
    }
    return <Demo />
  },
}
