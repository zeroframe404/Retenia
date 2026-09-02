import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from './badge'
import { Button } from './button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card'

const meta = {
  title: 'Components/Card',
  component: Card,
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Card className="w-80">
      <CardHeader>
        <CardTitle>FSRS-6 basics</CardTitle>
        <CardDescription>Module 3 · Lesson 2 of 5</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          Stability and retrievability drive when a card is due next — no hearts, no lives.
        </p>
        <Badge variant="xp" className="mt-3">
          +15 XP
        </Badge>
      </CardContent>
      <CardFooter>
        <Button className="w-full">Continue</Button>
      </CardFooter>
    </Card>
  ),
}
