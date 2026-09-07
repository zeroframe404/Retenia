import { Button, EmptyState } from '@retenia/ui'
import type { DetectedQuestion } from './detect-questions'

export interface QuestionPanelLabels {
  title: string
  convert: string
  empty: string
  kindLabel: (kind: DetectedQuestion['matchKind']) => string
}

export interface QuestionPanelProps {
  questions: readonly DetectedQuestion[]
  labels: QuestionPanelLabels
  onConvert: (question: DetectedQuestion) => void
}

/** The "Detectar preguntas de examen" side panel: candidate question blocks the local
 *  heuristic (`detectQuestions`) found, each with a one-click "Convertir en ítem". */
export function QuestionPanel({ questions, labels, onConvert }: QuestionPanelProps) {
  if (questions.length === 0) {
    return <EmptyState title={labels.empty} />
  }

  return (
    <section className="flex flex-col gap-2 p-3" aria-label={labels.title}>
      <h3 className="text-text text-sm font-medium">{labels.title}</h3>
      <ul className="flex flex-col gap-2">
        {questions.map((question) => (
          <li
            key={question.blockId}
            className="border-border flex flex-col gap-1.5 rounded-md border p-2"
          >
            <span className="text-muted text-[10px] tracking-wide uppercase">
              {labels.kindLabel(question.matchKind)}
            </span>
            <p className="text-text text-sm whitespace-pre-wrap">{question.text}</p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onConvert(question)}
            >
              {labels.convert}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
