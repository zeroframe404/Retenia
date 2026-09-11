import type { AffectedLessonsDto } from '@retenia/ipc-contract'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '../../../i18n'

/**
 * "Regenerar ruta" and "Regenerar afectadas" (sub-phase 8.6): the presentational panel, driven
 * only by its props.
 */

const SOURCE_ID = '019213cd-0000-7000-8000-00000000003a'

const NOTHING_CHANGED: AffectedLessonsDto = { sources: [], lessons: [] }

const SOURCES_CHANGED_NO_LESSONS: AffectedLessonsDto = {
  sources: [{ sourceId: SOURCE_ID, title: 'Fuente', reason: 'blob_changed' }],
  lessons: [],
}

const SOURCES_CHANGED_WITH_LESSONS: AffectedLessonsDto = {
  sources: [{ sourceId: SOURCE_ID, title: 'Fuente', reason: 'chunks_changed' }],
  lessons: [
    {
      lessonId: '019213cd-0000-7000-8000-000000000201',
      specId: 'L04',
      title: 'Movimiento rectilíneo',
      sourceIds: [SOURCE_ID],
      missingFragments: 2,
    },
    {
      lessonId: '019213cd-0000-7000-8000-000000000202',
      specId: 'L07',
      title: 'Tiro oblicuo',
      sourceIds: [SOURCE_ID],
      missingFragments: 1,
    },
  ],
}

const { RegeneratePanel } = await import('./regenerate-panel')

describe('RegeneratePanel', () => {
  it('disables "Regenerar ruta" and shows "Regenerando…" while regenerating', () => {
    render(
      <RegeneratePanel
        affected={undefined}
        regenerating
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    const button = screen.getByTestId('completion-regenerate')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Regenerando…')
  })

  it('disables "Regenerar afectadas" and shows "Regenerando…" while regenerating the affected lessons', () => {
    render(
      <RegeneratePanel
        affected={SOURCES_CHANGED_WITH_LESSONS}
        regenerating={false}
        regeneratingAffected
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    const button = screen.getByTestId('regenerate-affected')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Regenerando…')
  })

  it('renders the error as an alert', () => {
    render(
      <RegeneratePanel
        affected={undefined}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
        error="No se pudo regenerar la ruta. Probá de nuevo."
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'No se pudo regenerar la ruta. Probá de nuevo.',
    )
  })

  it('shows no error alert by default', () => {
    render(
      <RegeneratePanel
        affected={undefined}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows no affected section when affected.sources is empty', () => {
    render(
      <RegeneratePanel
        affected={NOTHING_CHANGED}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('affected-lessons')).not.toBeInTheDocument()
  })

  it('shows "Ninguna lección quedó desactualizada." when sources changed but no lesson is affected', () => {
    render(
      <RegeneratePanel
        affected={SOURCES_CHANGED_NO_LESSONS}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    expect(screen.getByTestId('affected-lessons')).toBeInTheDocument()
    expect(screen.getByText('Ninguna lección quedó desactualizada.')).toBeInTheDocument()
    expect(screen.queryByTestId('regenerate-affected')).not.toBeInTheDocument()
  })

  it('lists the affected lessons and their source when there are some', () => {
    render(
      <RegeneratePanel
        affected={SOURCES_CHANGED_WITH_LESSONS}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('affected-lesson')).toHaveLength(2)
    expect(screen.getByTestId('regenerate-affected')).toBeEnabled()
  })

  it('calls onRegenerate when "Regenerar ruta" is clicked', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    render(
      <RegeneratePanel
        affected={undefined}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={onRegenerate}
        onRegenerateAffected={vi.fn()}
      />,
    )

    await user.click(screen.getByTestId('completion-regenerate'))

    expect(onRegenerate).toHaveBeenCalledOnce()
  })

  it('calls onRegenerateAffected when "Regenerar afectadas" is clicked', async () => {
    const user = userEvent.setup()
    const onRegenerateAffected = vi.fn()
    render(
      <RegeneratePanel
        affected={SOURCES_CHANGED_WITH_LESSONS}
        regenerating={false}
        regeneratingAffected={false}
        onRegenerate={vi.fn()}
        onRegenerateAffected={onRegenerateAffected}
      />,
    )

    await user.click(screen.getByTestId('regenerate-affected'))

    expect(onRegenerateAffected).toHaveBeenCalledOnce()
  })
})
