import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Stepper } from './stepper'

const steps = [
  { id: 'a', label: 'Sources' },
  { id: 'b', label: 'Outline' },
  { id: 'c', label: 'Review' },
]

describe('Stepper', () => {
  it('marks the current step with aria-current', () => {
    render(<Stepper steps={steps} currentIndex={1} />)
    const current = screen.getByRole('button', { name: '2' })
    expect(current).toHaveAttribute('aria-current', 'step')
  })

  it('shows a checkmark for completed steps instead of the number', () => {
    render(<Stepper steps={steps} currentIndex={2} />)
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
  })

  it('disables upcoming steps but enables completed ones when onStepClick is given', () => {
    render(<Stepper steps={steps} currentIndex={1} onStepClick={() => {}} />)

    const upcoming = screen.getByRole('button', { name: '3' })
    expect(upcoming).toBeDisabled()

    const completed = screen.getAllByRole('button')[0]
    expect(completed).toBeEnabled()
  })

  it('calls onStepClick with the step index for a completed step', () => {
    const onStepClick = vi.fn()
    render(<Stepper steps={steps} currentIndex={2} onStepClick={onStepClick} />)
    const [firstButton] = screen.getAllByRole('button')
    fireEvent.click(firstButton as HTMLElement)
    expect(onStepClick).toHaveBeenCalledWith(0)
  })
})
