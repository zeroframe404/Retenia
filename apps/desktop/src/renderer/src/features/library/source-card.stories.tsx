import type { SourceSummary } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SourceCard } from './source-card'

const meta = {
  title: 'Library/SourceCard',
  component: SourceCard,
} satisfies Meta<typeof SourceCard>

export default meta
type Story = StoryObj<typeof meta>

const baseArgs = {
  onOpen: () => {},
  onRetry: () => {},
  onDelete: () => {},
}

const baseSource: SourceSummary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'pdf',
  title: 'Cálculo I.pdf',
  status: 'ready',
  language: 'es',
  error: null,
  meta: {
    sourceDocBlobSha256: 'a'.repeat(64),
    blockCount: 214,
    assetCount: 3,
    needsOcr: false,
    ocrPages: [],
    warnings: [],
  },
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
}

export const Ready: Story = {
  args: { ...baseArgs, source: baseSource },
}

export const Processing: Story = {
  args: {
    ...baseArgs,
    source: { ...baseSource, status: 'processing', meta: null, ingestedAt: null },
  },
}

export const Failed: Story = {
  args: {
    ...baseArgs,
    source: {
      ...baseSource,
      status: 'failed',
      meta: null,
      ingestedAt: null,
      error: 'No parser is implemented yet for source kind "video"',
    },
  },
}

export const NeedsOcr: Story = {
  args: {
    ...baseArgs,
    source: {
      ...baseSource,
      title: 'Apuntes escaneados.pdf',
      // biome-ignore lint/style/noNonNullAssertion: baseSource.meta is always set above
      meta: { ...baseSource.meta!, needsOcr: true, ocrPages: [3, 4, 12] },
    },
  },
}
