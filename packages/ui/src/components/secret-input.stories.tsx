import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SecretInput } from './secret-input'

const meta = {
  title: 'Components/SecretInput',
  component: SecretInput,
} satisfies Meta<typeof SecretInput>

export default meta
type Story = StoryObj<typeof meta>

function Controlled(props: { preview: string | null }) {
  const [value, setValue] = useState('')
  return (
    <SecretInput
      {...props}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder="sk-ant-…"
    />
  )
}

export const NoKeyStored: Story = {
  args: { preview: null },
  render: () => <Controlled preview={null} />,
}

export const KeyStored: Story = {
  args: { preview: '••••wxyz' },
  render: () => <Controlled preview="••••wxyz" />,
}

/** A key mid-entry, masked by default — click "Show key" to reveal what was typed. */
export const TypingANewKey: Story = {
  args: { preview: null, value: 'sk-ant-1234abcd' },
  render: (args) => <SecretInput {...args} onChange={() => {}} />,
}
