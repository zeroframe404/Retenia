import type { Meta, StoryObj } from '@storybook/react-vite'
import { CodeBlock } from './code-block'

const meta = {
  title: 'Components/CodeBlock',
  component: CodeBlock,
} satisfies Meta<typeof CodeBlock>

export default meta
type Story = StoryObj<typeof meta>

export const TypeScript: Story = {
  args: {
    language: 'typescript',
    filename: 'scheduler.ts',
    code: `export function nextInterval(stability: number, retention: number): number {
  return stability * Math.log(retention) / Math.log(0.9)
}`,
  },
}

export const Python: Story = {
  args: {
    language: 'python',
    code: `def fsrs_retrievability(elapsed_days: float, stability: float) -> float:
    return (1 + elapsed_days / (9 * stability)) ** -1`,
  },
}

export const PlainText: Story = {
  args: {
    code: 'No language given — renders as plain text.',
  },
}
