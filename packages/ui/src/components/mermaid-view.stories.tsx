import type { Meta, StoryObj } from '@storybook/react-vite'
import { MermaidView } from './mermaid-view'

const meta = {
  title: 'Components/MermaidView',
  component: MermaidView,
} satisfies Meta<typeof MermaidView>

export default meta
type Story = StoryObj<typeof meta>

export const FlowChart: Story = {
  args: {
    chart: `graph TD
  A[Read source] --> B[Extract concepts]
  B --> C[Sequence path]
  C --> D{QA gate passes?}
  D -- yes --> E[Freeze PathSpec]
  D -- no --> B`,
  },
}

export const SequenceDiagram: Story = {
  args: {
    chart: `sequenceDiagram
  participant U as User
  participant S as Scheduler
  U->>S: Rate card (Good)
  S->>S: Update S, D, R
  S-->>U: Next due date`,
  },
}

export const InvalidSyntax: Story = {
  args: { chart: 'this is not a valid mermaid diagram' },
}
