import type { Meta, StoryObj } from '@storybook/react-vite'
import { KatexInline } from './katex-inline'

const meta = {
  title: 'Components/KatexInline',
  component: KatexInline,
} satisfies Meta<typeof KatexInline>

export default meta
type Story = StoryObj<typeof meta>

export const Inline: Story = {
  args: { math: 'E = mc^2' },
}

export const Display: Story = {
  args: { math: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', displayMode: true },
}

export const InvalidSyntax: Story = {
  args: { math: '\\frac{1' },
}
