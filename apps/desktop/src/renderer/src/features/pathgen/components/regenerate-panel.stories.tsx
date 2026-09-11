import type { AffectedLessonsDto } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RegeneratePanel } from './regenerate-panel'

const meta: Meta<typeof RegeneratePanel> = {
  title: 'Pathgen/RegeneratePanel',
  component: RegeneratePanel,
  args: {
    regenerating: false,
    regeneratingAffected: false,
    onRegenerate: () => {},
    onRegenerateAffected: () => {},
  },
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

const nothingChanged: AffectedLessonsDto = { sources: [], lessons: [] }

const updatedSource: AffectedLessonsDto = {
  sources: [
    {
      sourceId: '019213cd-0000-7000-8000-00000000003a',
      title: 'Física I — apunte de cátedra',
      reason: 'blob_changed',
    },
  ],
  lessons: [
    {
      lessonId: '019213cd-0000-7000-8000-000000000201',
      specId: 'L04',
      title: 'Movimiento rectilíneo uniformemente variado',
      sourceIds: ['019213cd-0000-7000-8000-00000000003a'],
      missingFragments: 2,
    },
    {
      lessonId: '019213cd-0000-7000-8000-000000000202',
      specId: 'L07',
      title: 'Tiro oblicuo',
      sourceIds: ['019213cd-0000-7000-8000-00000000003a'],
      missingFragments: 1,
    },
  ],
}

export const UpToDate: Story = { args: { affected: nothingChanged } }

export const SourcesChanged: Story = { args: { affected: updatedSource } }

export const ChangedButNothingAffected: Story = {
  args: { affected: { sources: updatedSource.sources, lessons: [] } },
}

export const Regenerating: Story = { args: { affected: nothingChanged, regenerating: true } }

export const Failed: Story = {
  args: { affected: nothingChanged, error: 'No se pudo regenerar la ruta. Probá de nuevo.' },
}
