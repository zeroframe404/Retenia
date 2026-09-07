import type { Meta, StoryObj } from '@storybook/react-vite'
import { PdfReader } from './pdf-reader'
import type { PdfHighlight, PdfReaderLabels } from './types'

const meta = {
  title: 'Readers/PdfReader',
  component: PdfReader,
} satisfies Meta<typeof PdfReader>

export default meta
type Story = StoryObj<typeof meta>

/** The strings the app supplies from `packages/i18n`'s `library` namespace — spelled out here
 *  because `packages/readers` takes all of its copy as props, so a story needs no i18n
 *  provider (same rule `MediaPlayer`'s story follows). */
const labels: PdfReaderLabels = {
  pageOf: (page, total) => `Página ${page} de ${total}`,
  pageInputLabel: 'Número de página',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  zoomReset: 'Restablecer zoom',
  fitWidth: 'Ajustar al ancho',
  thumbnails: 'Miniaturas',
  searchPlaceholder: 'Buscar en el documento',
  searchNext: 'Siguiente resultado',
  searchPrev: 'Resultado anterior',
  matchOf: (index, total) => `${index} de ${total}`,
  noMatches: 'Sin resultados',
  loading: 'Cargando…',
  loadError: 'No se pudo abrir el PDF',
  detectQuestions: 'Detectar preguntas de examen',
  selectionToolbar: {
    highlight: 'Resaltar',
    createCard: 'Crear tarjeta',
    askAi: 'Preguntar a la IA',
    copyWithCitation: 'Copiar con cita',
  },
}

/** `test/fixtures/pdf/five-pages.pdf`, served by Storybook's `staticDirs` — a real PDF, so
 *  this story renders through the genuine pdf.js pipeline rather than a mock. */
const FIXTURE_SRC = '/pdf/five-pages.pdf'

export const Default: Story = {
  args: {
    src: FIXTURE_SRC,
    title: 'Cinco páginas',
    highlights: [],
    labels,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <PdfReader {...args} />
    </div>
  ),
}

const highlights: PdfHighlight[] = [
  {
    id: 'h1',
    page: 1,
    rects: [{ x: 0.12, y: 0.15, width: 0.5, height: 0.03 }],
    color: 'rgba(250, 204, 21, 0.45)',
  },
]

export const WithHighlight: Story = {
  args: {
    src: FIXTURE_SRC,
    title: 'Cinco páginas',
    highlights,
    labels,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <PdfReader {...args} />
    </div>
  ),
}

export const OpensAtPage3: Story = {
  args: {
    src: FIXTURE_SRC,
    title: 'Cinco páginas',
    highlights: [],
    labels,
    initialPage: 3,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <PdfReader {...args} />
    </div>
  ),
}

export const LoadError: Story = {
  args: {
    src: '/pdf/does-not-exist.pdf',
    title: 'Archivo inexistente',
    highlights: [],
    labels,
  },
  render: (args) => (
    <div style={{ height: '80vh' }}>
      <PdfReader {...args} />
    </div>
  ),
}
