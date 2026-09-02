import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileDropZone } from './file-drop-zone'

const meta = {
  title: 'Components/FileDropZone',
  component: FileDropZone,
} satisfies Meta<typeof FileDropZone>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    label: 'Drop a source here, or click to browse',
    hint: 'PDF, DOCX, EPUB, MP4, MP3, images — up to 500 MB',
    accept: '.pdf,.docx,.epub,video/*,audio/*,image/*',
    onFiles: () => {},
  },
}

export const Disabled: Story = {
  args: {
    label: 'Drop a source here, or click to browse',
    hint: 'Finish the current import before adding another',
    disabled: true,
    onFiles: () => {},
  },
}
