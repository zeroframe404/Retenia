import type { SearchHit } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchResults } from './search-results'

const meta = {
  title: 'Library/SearchResults',
  component: SearchResults,
} satisfies Meta<typeof SearchResults>

export default meta
type Story = StoryObj<typeof meta>

const baseArgs = {
  query: 'cómo circula la sangre',
  onOpenInSource: () => {},
  onCreateCard: () => {},
}

function hit(overrides: Partial<SearchHit>): SearchHit {
  return {
    chunkId: '019213cd-0000-7000-8000-0000000000a1',
    sourceId: '019213cd-0000-7000-8000-000000000001',
    sourceTitle: 'Fisiología humana.pdf',
    sourceKind: 'pdf',
    score: 0.91,
    fusionScore: 0.032,
    snippet:
      'El <b>corazón</b> bombea la <b>sangre</b> hacia los pulmones, donde se oxigena antes de volver…',
    highlighted: true,
    headingPath: 'Fisiología humana > Capítulo 3 · Sistema circulatorio > 3.2 El corazón',
    label: 'p. 112',
    page: 112,
    tStartMs: null,
    blockIds: ['b201', 'b202'],
    matchedFts: true,
    matchedVector: true,
    ...overrides,
  }
}

/** The normal case: both branches agreed, and the top hit carries a highlighted passage. */
export const Default: Story = {
  args: {
    ...baseArgs,
    tookMs: 38,
    hits: [
      hit({}),
      hit({
        chunkId: '019213cd-0000-7000-8000-0000000000a2',
        // A purely semantic hit: no FTS5 match, so no `<b>` and no `snippet()` — the head of
        // the chunk stands in.
        snippet:
          'La circulación menor lleva el fluido desde el ventrículo derecho hasta los alvéolos…',
        highlighted: false,
        matchedFts: false,
        headingPath: 'Fisiología humana > Capítulo 3 · Sistema circulatorio > 3.4 Circulación',
        label: 'p. 118',
        page: 118,
        score: 0.74,
      }),
      hit({
        chunkId: '019213cd-0000-7000-8000-0000000000a3',
        sourceTitle: 'Clase 04 — Circulatorio.mp4',
        sourceKind: 'video',
        snippet: '…y acá vemos cómo la <b>sangre</b> vuelve por las venas cavas…',
        headingPath: null,
        label: '12:30',
        page: null,
        tStartMs: 750_000,
        matchedVector: false,
        score: 0.51,
      }),
    ],
  },
}

/** No embedding model, or the model host could not answer: the results are BM25 only, and
 *  the screen says so instead of presenting them as the whole answer. */
export const Degraded: Story = {
  args: {
    ...baseArgs,
    tookMs: 12,
    degraded: true,
    hits: [hit({ matchedVector: false })],
  },
}

export const Loading: Story = {
  args: { ...baseArgs, hits: [], loading: true },
}

export const NoResults: Story = {
  args: { ...baseArgs, hits: [], query: 'fotosíntesis en la Antártida' },
}

/** Before the user has typed anything. */
export const Idle: Story = {
  args: { ...baseArgs, hits: [], query: '' },
}

/** Mid-flight on "crear tarjeta desde este fragmento". */
export const CreatingCard: Story = {
  args: {
    ...baseArgs,
    hits: [hit({})],
    creatingCardFor: '019213cd-0000-7000-8000-0000000000a1',
  },
}
