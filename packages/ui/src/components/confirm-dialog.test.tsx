import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './confirm-dialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        onOpenChange={() => {}}
        title="Delete this source?"
        onConfirm={() => {}}
      />,
    )
    expect(screen.queryByText('Delete this source?')).not.toBeInTheDocument()
  })

  it('shows the title and description when open', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete this source?"
        description="This cannot be undone."
        onConfirm={() => {}}
      />,
    )
    expect(screen.getByText('Delete this source?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete this source?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onOpenChange(false) when cancel is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete this source?"
        cancelLabel="Cancel"
        onConfirm={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables both buttons while confirming', () => {
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete this source?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {}}
        confirming
      />,
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })
})
