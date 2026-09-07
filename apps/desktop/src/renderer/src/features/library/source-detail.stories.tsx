import type {
  ChunkSummary,
  ContextualizationEstimateDto,
  SourceDocDto,
  SourceSummary,
} from '@retenia/ipc-contract'
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
    chunkCount: 2,
    unitCount: 2,
    frontmatterChunkCount: 1,
    chunkTokenCount: 60,
    chunkingVersion: '1:chars4',
  },
  blobSha256: 'b'.repeat(64),
  createdAt: '2026-09-02T00:00:00.000Z',
  ingestedAt: '2026-09-02T00:01:00.000Z',
  embeddingStatus: 'ready' as const,
  embeddingModelId: 'embeddinggemma-300m@768',
  embeddingError: null,
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

const chunks: ChunkSummary[] = [
  {
    id: '019213cd-0000-7000-8000-00000000000a',
    ordinal: 0,
    text: 'Contents\nCell Biology ..... 1\nCell Structure ..... 4',
    truncated: false,
    tokenCount: 14,
    headingPath: 'Cell Biology > Contents',
    context: null,
    isFrontmatter: true,
    label: 'p. 1',
    page: 1,
    tStartMs: null,
    tEndMs: null,
    blockIds: ['b0'],
  },
  {
    id: '019213cd-0000-7000-8000-00000000000b',
    ordinal: 1,
    text: 'Cells are the basic building blocks of all living things.\n\nEvery cell has a membrane, cytoplasm, and genetic material.',
    truncated: false,
    tokenCount: 46,
    headingPath: 'Cell Biology > Cell Structure',
    context: 'From chapter 1 of Cell Biology, introducing the cell as the unit of life.',
    isFrontmatter: false,
    label: 'p. 2',
    page: 2,
    tStartMs: null,
    tEndMs: null,
    blockIds: ['b1', 'b2'],
  },
]

const estimate: ContextualizationEstimateDto = {
  chunkCount: 1,
  inputTokens: 2_400,
  cachedInputTokens: 0,
  outputTokens: 100,
  usd: 0.0021,
}

/** Everything the panel shows at once: front matter flagged, one chunk already contextualized
 *  and one still to go, and the price of finishing the job. */
const chunkArgs = {
  chunks,
  chunkTotal: chunks.length,
  estimate,
  excludeFrontmatter: false,
  onExcludeFrontmatterChange: () => {},
}

export const WithDoc: Story = {
  args: { source, doc, ...chunkArgs, onBack: () => {} },
}

export const NotChunkedYet: Story = {
  args: {
    source: {
      ...source,
      meta: { ...(source.meta as NonNullable<SourceSummary['meta']>), chunkCount: 0, unitCount: 0 },
    },
    doc,
    ...chunkArgs,
    chunks: [],
    chunkTotal: 0,
    estimate: { chunkCount: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, usd: 0 },
    onBack: () => {},
  },
}

export const NotYetParsed: Story = {
  args: {
    source: { ...source, status: 'processing', meta: null, ingestedAt: null },
    doc: undefined,
    ...chunkArgs,
    chunks: [],
    chunkTotal: 0,
    estimate: undefined,
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
    ...chunkArgs,
    onBack: () => {},
  },
}
