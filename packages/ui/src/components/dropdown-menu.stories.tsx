import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'

const meta = {
  title: 'Components/DropdownMenu',
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Card actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>Priority</DropdownMenuGroupLabel>
          <DropdownMenuItem>Set to urgent</DropdownMenuItem>
          <DropdownMenuItem>Set to maintenance</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked>Suspend</DropdownMenuCheckboxItem>
        <DropdownMenuItem>Edit card</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
}
