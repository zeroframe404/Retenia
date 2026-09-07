import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DetectedQuestion } from './detect-questions'
import { QuestionPanel } from './question-panel'

const labels = {
  title: 'Detectar preguntas de examen',
  convert: 'Convertir en ítem',
  empty: 'No se detectaron preguntas',
  kindLabel: (kind: DetectedQuestion['matchKind']) => kind,
}

describe('QuestionPanel', () => {
  it('shows an empty state when there are no candidates', () => {
    render(<QuestionPanel questions={[]} labels={labels} onConvert={vi.fn()} />)
    expect(screen.getByText(labels.empty)).toBeInTheDocument()
  })

  it('lists each candidate and converts the one clicked', async () => {
    const user = userEvent.setup()
    const onConvert = vi.fn()
    const questions: DetectedQuestion[] = [
      { blockId: 'b1', text: '¿Qué es la homeostasis?', matchKind: 'question-mark' },
      { blockId: 'b2', text: 'Ejercicio 2: resuelva la ecuación.', matchKind: 'exercise-label' },
    ]
    render(<QuestionPanel questions={questions} labels={labels} onConvert={onConvert} />)

    expect(screen.getByText(questions[0]?.text ?? '')).toBeInTheDocument()
    expect(screen.getByText(questions[1]?.text ?? '')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button', { name: labels.convert })
    expect(buttons).toHaveLength(2)
    await user.click(buttons[1] as HTMLElement)

    expect(onConvert).toHaveBeenCalledTimes(1)
    expect(onConvert).toHaveBeenCalledWith(questions[1])
  })
})
