import type { SourceDocDto, SourceSummary } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SourceDetail } from './source-detail'

const meta = {
  title: 'Library/SourceDetail',
  component: SourceDetail,
} satisfies Meta<typeof SourceDetail>

export default meta
type Story = StoryObj<typeof meta>

const source: SourceSummary = {
  id: '019213cd-0000-7000-8000-000000000001',
  kind: 'markdown',
  title: 'Cell Biology.md',
  status: 'ready',
  language: 'en',
  error: null,
  meta: {
    sourceDocBlobSha256: 'a'.repeat(64),
    blockCount: 4,
    assetCount: 0,
    needsOcr: false,
    ocrPages: [],
    warnings: [],
  },
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
}

const doc: SourceDocDto = {
  id: 'doc-1',
  kind: 'markdown',
  title: 'Cell Biology',
  language: 'en',
  sections: [
    {
      id: 's1',
      title: 'Cell Biology',
      level: 1,
      blocks: ['b1'],
      children: [
        {
          id: 's2',
          title: 'Cell Structure',
          level: 2,
          blocks: ['b2', 'b3'],
          children: [],
        },
      ],
    },
  ],
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      text: 'Cells are the basic building blocks of all living things.',
      locator: { anchor: '0' },
      hash: 'a'.repeat(64),
    },
    {
      id: 'b2',
      type: 'paragraph',
      text: 'Every cell has a membrane, cytoplasm, and genetic material.',
      locator: { anchor: '1' },
      hash: 'b'.repeat(64),
    },
    {
      id: 'b3',
      type: 'list',
      text: 'Nucleus\nMitochondria\nRibosomes',
      locator: { anchor: '2' },
      hash: 'c'.repeat(64),
    },
  ],
  assets: [],
  meta: { warnings: [] },
}

export const WithDoc: Story = {
  args: { source, doc, onBack: () => {} },
}

export const NotYetParsed: Story = {
  args: {
    source: { ...source, status: 'processing', meta: null, ingestedAt: null },
    doc: undefined,
    onBack: () => {},
  },
}

export const WithWarnings: Story = {
  args: {
    source: {
      ...source,
      // biome-ignore lint/style/noNonNullAssertion: source.meta is always set above
      meta: { ...source.meta!, needsOcr: true, ocrPages: [2] },
    },
    doc: {
      ...doc,
      meta: {
        warnings: ['2 equations could not be converted and are not represented in this document'],
      },
    },
    onBack: () => {},
  },
}
