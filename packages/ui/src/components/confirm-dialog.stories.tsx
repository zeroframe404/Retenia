import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './button'
import { ConfirmDialog } from './confirm-dialog'

const meta = {
  title: 'Components/ConfirmDialog',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Bury this card</Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Bury this card for today?"
            description="It won't come up for review again until tomorrow."
            confirmLabel="Bury"
            onConfirm={() => setOpen(false)}
          />
        </>
      )
    }
    return <Demo />
  },
}

export const Destructive: Story = {
  render: () => {
    function Demo() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete source
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Delete this source?"
            description="Every card and path node generated from it is deleted too. This cannot be undone."
            confirmLabel="Delete"
            destructive
            onConfirm={() => setOpen(false)}
          />
        </>
      )
    }
    return <Demo />
  },
}
