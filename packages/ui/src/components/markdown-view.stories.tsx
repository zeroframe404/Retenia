import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarkdownView } from './markdown-view'

const meta = {
  title: 'Components/MarkdownView',
  component: MarkdownView,
} satisfies Meta<typeof MarkdownView>

export default meta
type Story = StoryObj<typeof meta>

const FULL_DEMO = `# Spaced repetition, briefly

Retention decays over time unless you retrieve the memory again — that's the whole idea
behind **FSRS**. The probability of recall at time $t$ is:

$$
R(t) = \\left(1 + \\frac{t}{9S}\\right)^{-1}
$$

Where $S$ is *stability*, in days.

## What the scheduler tracks

| Field | Meaning |
| --- | --- |
| \`stability\` | Days until R drops to ~90% |
| \`difficulty\` | 1–10, how hard this item is for you |
| \`due\` | Next scheduled review |

- [x] Read chapter 3
- [ ] Review flashcards
- [ ] Take the mock exam

> "Errors are scheduler data; they are never punished." — docs/spec/01-decisions.md

\`\`\`typescript
function retrievability(elapsedDays: number, stability: number): number {
  return (1 + elapsedDays / (9 * stability)) ** -1
}
\`\`\`

\`\`\`mermaid
graph LR
  A[Review] -->|Good| B[S increases]
  A -->|Again| C[S resets]
\`\`\`
`

export const FullDemo: Story = {
  args: { children: FULL_DEMO },
}

export const InlineCodeAndMath: Story = {
  args: { children: 'Call `nextInterval()` — it returns $S \\cdot \\ln(R) / \\ln(0.9)$.' },
}
