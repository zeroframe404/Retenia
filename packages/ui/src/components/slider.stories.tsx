import type { Meta, StoryObj } from '@storybook/react-vite'
import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from './slider'

const meta = {
  title: 'Components/Slider',
  component: Slider,
} satisfies Meta<typeof Slider>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <div className="w-64">
      <Slider defaultValue={90} min={70} max={97}>
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  ),
}
