import type { DiagnosticSectionDto } from '@retenia/ipc-contract'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { SelfAssessmentForm, type SelfAssessmentFormProps } from './self-assessment-form'

function uuid(n: number): string {
  return `019213cd-0000-7000-8000-${String(n).padStart(12, '0')}`
}

function section(
  n: number,
  title: string,
  modules: string[],
  selfDeclared = false,
): DiagnosticSectionDto {
  return {
    id: uuid(n),
    specId: `S0${n}`,
    title,
    modules: modules.map((module, index) => ({
      id: uuid(n * 100 + index),
      specId: `S0${n}M${index + 1}`,
      title: module,
    })),
    selfDeclared,
  }
}

const SECTIONS = [
  section(1, 'Cinemática', ['Movimiento rectilíneo', 'Tiro oblicuo']),
  section(2, 'Dinámica', ['Leyes de Newton', 'Rozamiento', 'Trabajo y energía']),
  section(3, 'Fluidos', ['Hidrostática']),
  section(4, 'Magnitudes y unidades', ['Sistema internacional'], true),
]

/** The form is controlled; the story keeps the levels so the segmented controls respond. */
function Interactive(props: SelfAssessmentFormProps) {
  const [levels, setLevels] = useState(props.levels)
  return (
    <SelfAssessmentForm
      {...props}
      levels={levels}
      onChange={(sectionId, level) => {
        setLevels((previous) => ({ ...previous, [sectionId]: level }))
        props.onChange(sectionId, level)
      }}
    />
  )
}

const meta: Meta<typeof SelfAssessmentForm> = {
  title: 'Pathgen/SelfAssessmentForm',
  component: SelfAssessmentForm,
  render: (args) => <Interactive {...args} />,
  decorators: [
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { sections: SECTIONS.slice(0, 3), levels: {}, onChange: () => {} },
}

/** A section already marked "ya lo sé" in the preview is listed, never asked. */
export const WithSectionsKnownInPreview: Story = {
  args: {
    sections: SECTIONS,
    levels: { [uuid(2)]: 'know', [uuid(3)]: 'never' },
    onChange: () => {},
  },
}

export const WhileStarting: Story = {
  args: { sections: SECTIONS.slice(0, 3), levels: {}, onChange: () => {}, disabled: true },
}
