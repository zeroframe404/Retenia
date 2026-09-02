import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './button'
import { Celebration, type CelebrationVariant } from './celebration'

const meta = {
  title: 'Components/Celebration',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function Demo({
  variant,
  title,
  description,
}: {
  variant: CelebrationVariant
  title: string
  description?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Trigger celebration</Button>
      <Celebration
        open={open}
        onOpenChange={setOpen}
        variant={variant}
        title={title}
        description={description}
      />
    </>
  )
}

export const LessonComplete: Story = {
  render: () => (
    <Demo
      variant="lessonComplete"
      title="Lesson complete!"
      description="7 concepts added to your memory."
    />
  ),
}

export const StreakMilestone: Story = {
  render: () => (
    <Demo variant="streakMilestone" title="7-day streak!" description="Keep it going." />
  ),
}

export const ExamPassed: Story = {
  render: () => (
    <Demo variant="examPassed" title="Exam passed!" description="You're ready — great work." />
  ),
}

export const DailyGoal: Story = {
  render: () => <Demo variant="dailyGoal" title="Daily goal reached!" />,
}
