import type { VersionDiffDto } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { VersionDiffPanel } from './version-diff-panel'

const meta: Meta<typeof VersionDiffPanel> = {
  title: 'Pathgen/VersionDiffPanel',
  component: VersionDiffPanel,
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

const diff: VersionDiffDto = {
  fromVersion: 1,
  toVersion: 2,
  lessons: [
    {
      change: 'unchanged',
      specId: 'L01',
      title: 'Qué es la velocidad',
      previousSpecId: 'L01',
      previousTitle: 'Qué es la velocidad',
      addedConcepts: [],
      removedConcepts: [],
      keptConcepts: ['velocidad'],
    },
    {
      change: 'changed',
      specId: 'L02',
      title: 'Aceleración y gráficos',
      previousSpecId: 'L03',
      previousTitle: 'Aceleración',
      addedConcepts: ['grafico-v-t'],
      removedConcepts: [],
      keptConcepts: ['aceleracion'],
    },
    {
      change: 'added',
      specId: 'L03',
      title: 'Caída libre',
      previousSpecId: null,
      previousTitle: null,
      addedConcepts: ['caida-libre'],
      removedConcepts: [],
      keptConcepts: [],
    },
    {
      change: 'removed',
      specId: null,
      title: null,
      previousSpecId: 'L02',
      previousTitle: 'Unidades y conversiones',
      addedConcepts: [],
      removedConcepts: ['unidades'],
      keptConcepts: [],
    },
  ],
  concepts: { added: ['grafico-v-t', 'caida-libre'], removed: ['unidades'], kept: 2 },
  summary: { unchanged: 1, changed: 1, added: 1, removed: 1 },
  conceptNames: {
    'grafico-v-t': 'Gráfico velocidad-tiempo',
    'caida-libre': 'Caída libre',
    unidades: 'Unidades',
  },
}

export const Mixed: Story = { args: { diff } }

export const NothingChanged: Story = {
  args: {
    diff: {
      ...diff,
      lessons: diff.lessons.slice(0, 1),
      concepts: { added: [], removed: [], kept: 1 },
      summary: { unchanged: 1, changed: 0, added: 0, removed: 0 },
      conceptNames: {},
    },
  },
}
