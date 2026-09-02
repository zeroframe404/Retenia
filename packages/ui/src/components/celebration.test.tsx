import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGamificationProfileStore } from '../gamification/gamification-store'
import { Celebration } from './celebration'

vi.mock('canvas-confetti', () => {
  const create = vi.fn(() => Object.assign(vi.fn(), { reset: vi.fn() }))
  return { default: Object.assign(vi.fn(), { create }) }
})

vi.mock('@lottiefiles/dotlottie-react', () => ({
  DotLottieReact: () => null,
}))

function matchMedia(matches: boolean) {
  return (query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
}

beforeEach(() => {
  useGamificationProfileStore.setState({ profile: 'arcade' })
  vi.stubGlobal('matchMedia', matchMedia(false))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Celebration', () => {
  it('renders the title and description when open', () => {
    render(
      <Celebration
        open
        onOpenChange={() => {}}
        variant="lessonComplete"
        title="Lesson complete!"
        description="7 concepts added to memory."
      />,
    )
    expect(screen.getByText('Lesson complete!')).toBeInTheDocument()
    expect(screen.getByText('7 concepts added to memory.')).toBeInTheDocument()
  })

  it('renders nothing and closes itself in sober mode', () => {
    useGamificationProfileStore.setState({ profile: 'sober' })
    const onOpenChange = vi.fn()
    render(
      <Celebration
        open
        onOpenChange={onOpenChange}
        variant="streakMilestone"
        title="7-day streak!"
      />,
    )
    expect(screen.queryByText('7-day streak!')).not.toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders nothing and closes itself under reduced motion', () => {
    vi.stubGlobal('matchMedia', matchMedia(true))
    const onOpenChange = vi.fn()
    render(
      <Celebration open onOpenChange={onOpenChange} variant="examPassed" title="Exam passed!" />,
    )
    expect(screen.queryByText('Exam passed!')).not.toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('auto-dismisses within the 2.5s cap', () => {
    vi.useFakeTimers()
    const onOpenChange = vi.fn()
    render(
      <Celebration open onOpenChange={onOpenChange} variant="dailyGoal" title="Goal reached!" />,
    )

    vi.advanceTimersByTime(2499)
    expect(onOpenChange).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('is skippable via Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Celebration open onOpenChange={onOpenChange} variant="dailyGoal" title="Goal reached!" />,
    )

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalled()
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })

  it('does not render when closed', () => {
    render(
      <Celebration
        open={false}
        onOpenChange={() => {}}
        variant="dailyGoal"
        title="Goal reached!"
      />,
    )
    expect(screen.queryByText('Goal reached!')).not.toBeInTheDocument()
  })
})
