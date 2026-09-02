import type { Meta, StoryObj } from '@storybook/react-vite'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Button } from './components/button'
import { celebrate, fadeIn, pop, shake, slideUp } from './motion'

const presets = { fadeIn, slideUp, pop, shake, celebrate }

function MotionDemo() {
  const [active, setActive] = useState<keyof typeof presets | null>(null)
  const [key, setKey] = useState(0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(presets) as (keyof typeof presets)[]).map((name) => (
          <Button
            key={name}
            variant={active === name ? 'primary' : 'outline'}
            onClick={() => {
              setActive(name)
              setKey((k) => k + 1)
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      <div className="border-border flex h-32 w-64 items-center justify-center rounded-lg border">
        <AnimatePresence mode="wait">
          {active && (
            <motion.div
              key={key}
              variants={presets[active]}
              initial="initial"
              animate="animate"
              exit="exit"
              className="bg-brand-600 rounded-lg px-6 py-4 font-medium text-white"
            >
              {active}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

const meta = {
  title: 'Foundations/Motion',
  render: () => <MotionDemo />,
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Presets: Story = {}
