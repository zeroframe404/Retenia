import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorState } from './error-state'

describe('ErrorState', () => {
  it('is announced as an alert', () => {
    render(<ErrorState title="Could not load this path" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this path')
  })

  it('calls onRetry when the retry button is clicked', () => {
    const onRetry = vi.fn()
    render(<ErrorState title="Failed" retryLabel="Retry" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('omits the retry button when onRetry is not given', () => {
    render(<ErrorState title="Failed" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
