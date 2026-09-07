import type { Meta, StoryObj } from '@storybook/react-vite'
import { EpubReader } from './epub-reader'
import type { EpubReaderLabels } from './types'

const meta = {
  title: 'Readers/EpubReader',
  component: EpubReader,
} satisfies Meta<typeof EpubReader>

export default meta
type Story = StoryObj<typeof meta>

/** The strings the app supplies from `packages/i18n`'s `library` namespace — spelled out here
 *  because `packages/readers` takes all of its copy as props, so a story needs no i18n
 *  provider (same rule `MediaPlayer`'s and `PdfReader`'s stories follow). */
const labels: EpubReaderLabels = {
  sectionOf: (index, total) => `Sección ${index} de ${total}`,
  tableOfContents: 'Índice',
  searchPlaceholder: 'Buscar en esta sección',
  searchNext: 'Siguiente resultado',
  searchPrev: 'Resultado anterior',
  matchOf: (index, total) => `${index} de ${total}`,
  noMatches: 'Sin resultados',
  loading: 'Cargando…',
  loadError: 'No se pudo abrir el EPUB',
  detectQuestions: 'Detectar preguntas de examen',
  selectionToolbar: {
    highlight: 'Resaltar',
    createCard: 'Crear tarjeta',
    askAi: 'Preguntar a la IA',
    copyWithCitation: 'Copiar con cita',
  },
}

/** `test/fixtures/epub/sample.epub`, served by Storybook's `staticDirs` — a real EPUB, read
 *  through the genuine `makeHttpEpubLoader`/`vendor/foliate-js` pipeline rather than a mock. */
const FIXTURE_SRC = '/epub/sample.epub'

export const Default: Story = {
  args: {
    src: FIXTURE_SRC,
    title: 'Libro de muestra',
    highlights: [],
    labels,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <EpubReader {...args} />
    </div>
  ),
}

export const LoadError: Story = {
  args: {
    src: '/epub/does-not-exist.epub',
    title: 'Archivo inexistente',
    highlights: [],
    labels,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <EpubReader {...args} />
    </div>
  ),
}
