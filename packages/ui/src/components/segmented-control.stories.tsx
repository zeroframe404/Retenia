import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SegmentedControl } from './segmented-control'

const meta = {
  title: 'Components/SegmentedControl',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState<'comfortable' | 'compact'>('comfortable')
      return (
        <SegmentedControl
          aria-label="Density"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      )
    }
    return <Demo />
  },
}

export const ThreeOptionsWithDisabled: Story = {
  render: () => {
    function Demo() {
      const [value, setValue] = useState<'list' | 'grid' | 'map'>('list')
      return (
        <SegmentedControl
          aria-label="View"
          value={value}
          onValueChange={setValue}
          options={[
            { value: 'list', label: 'List' },
            { value: 'grid', label: 'Grid' },
            { value: 'map', label: 'Map', disabled: true },
          ]}
        />
      )
    }
    return <Demo />
  },
}
