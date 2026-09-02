import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import { PageHeader } from './page-header'

const meta = {
  title: 'Components/PageHeader',
  component: PageHeader,
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: 'Biology 101',
    subtitle: '42 lessons · generated from "Campbell Biology" (chapters 1–12)',
  },
}

export const WithActions: Story = {
  args: {
    title: 'Source library',
    subtitle: '18 sources · 3 processing',
    actions: (
      <>
        <Button variant="outline">Import</Button>
        <Button>Add source</Button>
      </>
    ),
  },
}
