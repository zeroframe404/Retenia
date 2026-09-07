import type { Meta, StoryObj } from '@storybook/react-vite'
import { ThirdPartyNoticesSection } from './third-party-notices-section'

const meta = {
  title: 'Settings/ThirdPartyNoticesSection',
  component: ThirdPartyNoticesSection,
} satisfies Meta<typeof ThirdPartyNoticesSection>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
