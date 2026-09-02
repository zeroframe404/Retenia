import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SegmentedControlOption } from './segmented-control'
import { SegmentedControl } from './segmented-control'

const options: SegmentedControlOption<'a' | 'b' | 'c'>[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
]

describe('SegmentedControl', () => {
  it('marks the selected option as checked', () => {
    render(
      <SegmentedControl aria-label="Demo" value="b" onValueChange={() => {}} options={options} />,
    )
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-checked', 'false')
  })

  it('calls onValueChange when an option is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Demo"
        value="a"
        onValueChange={onValueChange}
        options={options}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'C' }))
    expect(onValueChange).toHaveBeenCalledWith('c')
  })

  it('moves selection with ArrowRight/ArrowLeft', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Demo"
        value="a"
        onValueChange={onValueChange}
        options={options}
      />,
    )
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' })
    expect(onValueChange).toHaveBeenCalledWith('b')

    onValueChange.mockClear()
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' })
    expect(onValueChange).toHaveBeenCalledWith('c')
  })

  it('does not select a disabled option', () => {
    const onValueChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Demo"
        value="a"
        onValueChange={onValueChange}
        options={[...options.slice(0, 2), { value: 'c', label: 'C', disabled: true }]}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: 'C' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
