import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Countdown } from './countdown'

describe('Countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders days and hours for a far target', () => {
    render(<Countdown target={new Date('2026-09-08T03:00:00Z')} />)
    expect(screen.getByText('6d 3h')).toBeInTheDocument()
  })

  it('renders "Due" once the target has passed', () => {
    render(<Countdown target={new Date('2026-09-01T00:00:00Z')} />)
    expect(screen.getByText('Due')).toBeInTheDocument()
  })

  it('ticks down as time advances', () => {
    render(<Countdown target={new Date('2026-09-02T00:05:00Z')} intervalMs={1000} />)
    expect(screen.getByText('5m 0s')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('4m 0s')).toBeInTheDocument()
  })

  it('uses a custom format function', () => {
    render(
      <Countdown
        target={new Date('2026-09-03T00:00:00Z')}
        format={(d) => `${d.days} day(s) left`}
      />,
    )
    expect(screen.getByText('1 day(s) left')).toBeInTheDocument()
  })
})
