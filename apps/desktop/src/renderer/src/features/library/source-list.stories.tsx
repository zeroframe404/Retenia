import type { SourceSummary } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SourceList } from './source-list'

const meta = {
  title: 'Library/SourceList',
  component: SourceList,
} satisfies Meta<typeof SourceList>

export default meta
type Story = StoryObj<typeof meta>

const baseArgs = {
  onOpen: () => {},
  onRetry: () => {},
  onDelete: () => {},
  onAddFromDialog: () => {},
  onDropFiles: () => {},
  onAddFromText: () => {},
}

function source(overrides: Partial<SourceSummary>): SourceSummary {
  return {
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
    embeddingStatus: 'ready' as const,
    embeddingModelId: 'embeddinggemma-300m@768',
    embeddingError: null,
    ...overrides,
  }
}

export const Empty: Story = {
  args: { ...baseArgs, sources: [] },
}

export const WithSources: Story = {
  args: {
    ...baseArgs,
    sources: [
      source({}),
      source({
        id: '019213cd-0000-7000-8000-000000000002',
        kind: 'epub',
        title: 'Introducción a la Biología.epub',
        status: 'processing',
        meta: null,
        ingestedAt: null,
        embeddingStatus: 'ready' as const,
        embeddingModelId: 'embeddinggemma-300m@768',
        embeddingError: null,
      }),
      source({
        id: '019213cd-0000-7000-8000-000000000003',
        kind: 'pptx',
        title: 'Clase 03.pptx',
        status: 'failed',
        meta: null,
        ingestedAt: null,
        embeddingStatus: 'ready' as const,
        embeddingModelId: 'embeddinggemma-300m@768',
        embeddingError: null,
        error: 'No parser is implemented yet for source kind "video"',
      }),
    ],
  },
}
