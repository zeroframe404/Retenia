import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef } from 'react'
import { Button } from './button'
import { Mascot, type MascotHandle, type MascotReactKind } from './mascot'

const meta = {
  title: 'Components/Mascot',
  component: Mascot,
  args: { mood: 'idle', intensity: 1, size: 120 },
  argTypes: {
    mood: { control: 'select', options: ['idle', 'happy', 'thinking', 'sad', 'celebrate'] },
    intensity: { control: { type: 'range', min: 0, max: 1, step: 0.1 } },
  },
} satisfies Meta<typeof Mascot>

export default meta
type Story = StoryObj<typeof meta>

/** Drives `mood` from the Controls panel — pick any option to see the mascot react. */
export const Default: Story = {}

export const Idle: Story = { args: { mood: 'idle' } }
export const Happy: Story = { args: { mood: 'happy' } }
export const Thinking: Story = { args: { mood: 'thinking' } }
export const Sad: Story = { args: { mood: 'sad' } }
export const Celebrate: Story = { args: { mood: 'celebrate' } }

export const LowIntensity: Story = {
  args: { mood: 'happy', intensity: 0.3 },
}

const REACT_KINDS: MascotReactKind[] = ['correct', 'wrong', 'streak', 'celebrate']

/** The imperative `react(kind)` trigger, fired on top of the current mood. */
export const Reactions: Story = {
  render: (args) => {
    function ReactionsDemo() {
      const ref = useRef<MascotHandle>(null)
      return (
        <div className="flex flex-col items-center gap-4">
          <Mascot {...args} ref={ref} />
          <div className="flex gap-2">
            {REACT_KINDS.map((kind) => (
              <Button
                key={kind}
                size="sm"
                variant="outline"
                onClick={() => ref.current?.react(kind)}
              >
                {kind}
              </Button>
            ))}
          </div>
        </div>
      )
    }
    return <ReactionsDemo />
  },
}
