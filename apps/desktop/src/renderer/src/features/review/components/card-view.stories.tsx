import { Card } from '@retenia/ui'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { CardView } from './card-view'

// An explicit annotation, not `satisfies Meta`: TS's declaration-emit check cannot
// portably name a `decorators` array's inferred story-render-prop type, and errors
// (TS2883) unless the shape is spelled out up front instead of inferred.
const meta: Meta = {
  title: 'Review/CardView',
  decorators: [
    (Story) => (
      <Card className="max-w-xl p-6">
        <Story />
      </Card>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

function Interactive(props: { template: string; fields: unknown; startRevealed?: boolean }) {
  const [revealed, setRevealed] = useState(props.startRevealed ?? false)
  return (
    <CardView
      template={props.template}
      fields={props.fields}
      revealed={revealed}
      onReveal={() => setRevealed(true)}
    />
  )
}

export const BasicFront: Story = {
  render: () => (
    <Interactive
      template="basic"
      fields={{ front: 'What is the capital of France?', back: 'Paris' }}
    />
  ),
}

export const BasicRevealed: Story = {
  render: () => (
    <Interactive
      template="basic"
      fields={{ front: 'What is the capital of France?', back: 'Paris' }}
      startRevealed
    />
  ),
}

export const ReverseFront: Story = {
  render: () => (
    <Interactive
      template="reverse"
      fields={{ front: 'What is the capital of France?', back: 'Paris' }}
    />
  ),
}

export const ReverseRevealed: Story = {
  render: () => (
    <Interactive
      template="reverse"
      fields={{ front: 'What is the capital of France?', back: 'Paris' }}
      startRevealed
    />
  ),
}

const CLOZE_FIELDS = {
  cloze_text:
    'The mitochondria is the {{c1::powerhouse::organelle}} of the cell, producing {{c2::ATP}}.',
}

export const ClozeFront: Story = {
  render: () => <Interactive template="cloze:c1" fields={CLOZE_FIELDS} />,
}

export const ClozeRevealed: Story = {
  render: () => <Interactive template="cloze:c1" fields={CLOZE_FIELDS} startRevealed />,
}

export const ClozeSecondBlank: Story = {
  name: 'Cloze (sibling: c2, no hint)',
  render: () => <Interactive template="cloze:c2" fields={CLOZE_FIELDS} />,
}

const TYPE_IN_FIELDS = { front: 'Type the capital of France', back: 'Paris' }

export const TypeInFront: Story = {
  render: () => <Interactive template="type_in" fields={TYPE_IN_FIELDS} />,
}

export const TypeInRevealed: Story = {
  name: 'Type-in (revealed, unanswered → incorrect)',
  render: () => <Interactive template="type_in" fields={TYPE_IN_FIELDS} startRevealed />,
}

export const UnknownTemplateFallsBackToBasic: Story = {
  render: () => (
    <Interactive
      template="mcq"
      fields={{ front: 'An unrecognized template', back: 'still shows something' }}
    />
  ),
}
