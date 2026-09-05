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

/** LaTeX can come from AI-generated content, so `KATEX_OPTIONS` keeps `trust: false`: the
 * commands that would let an expression author HTML render as inert error text instead of
 * a link or an attribute. */
export const UntrustedCommands: Story = {
  args: { math: '\\href{javascript:alert(1)}{x}\\quad\\htmlData{a=b}{y}' },
}

/** `maxSize` caps every user-specified length at 25em; KaTeX's own default is `Infinity`,
 * which would lay this out as a 100000em box. */
export const BoundedSize: Story = {
  args: { math: '\\rule{100000em}{100000em}', displayMode: true },
}
