/**
 * "Detectar preguntas de examen" (`docs/spec/08-ux.md` §2, sub-phase 6.6): a local heuristic
 * over the reader's already-extracted text blocks — question marks, "Ejercicio"/"Problema"
 * labels, numbered items — listing candidates for one-click "convertir en ítem". The
 * LLM-assisted version is sub-phase 8.4's QA-gated generation pipeline; this one runs with no
 * network call and no cost, entirely offline.
 */

export interface TextBlock {
  id: string
  text: string
}

export type QuestionMatchKind = 'question-mark' | 'exercise-label' | 'numbered-item'

export interface DetectedQuestion {
  blockId: string
  text: string
  matchKind: QuestionMatchKind
}

/** "Ejercicio 3", "Exercise 3", "Problema 12", "Pregunta 5" — es-AR first, en second, matching
 *  `packages/i18n`'s locale order. */
const EXERCISE_LABEL = /^\s*(ejercicio|exercise|problema|problem|pregunta|question)s?\b/i

/** "1.", "1)", "12 -" at the start of the block — a numbered list item, the shape most
 *  textbook problem sets use. Requires at least one more non-space character after the
 *  marker, so a lone page-number line ("12.") does not count. */
const NUMBERED_ITEM = /^\s*\d{1,3}[.)-]\s+\S/

/** Blank or effectively blank (whitespace, or a single stray digit/punctuation) — never a
 *  question candidate no matter what else matches. */
const BLANK = /^\s*$/

function classify(text: string): QuestionMatchKind | null {
  const trimmed = text.trim()
  if (BLANK.test(trimmed)) return null
  // Order matters: a numbered exercise ("1. Ejercicio: ¿qué es...?") is labelled by its
  // strongest signal, so a reader scanning the panel sees *why* each line was picked.
  if (trimmed.endsWith('?')) return 'question-mark'
  if (EXERCISE_LABEL.test(trimmed)) return 'exercise-label'
  if (NUMBERED_ITEM.test(trimmed)) return 'numbered-item'
  return null
}

/** Runs the heuristic over a source's text blocks, in reading order. A block matches at most
 *  once, under whichever rule fired first (`classify`'s order). */
export function detectQuestions(blocks: readonly TextBlock[]): DetectedQuestion[] {
  const found: DetectedQuestion[] = []
  for (const block of blocks) {
    const matchKind = classify(block.text)
    if (matchKind !== null) found.push({ blockId: block.id, text: block.text.trim(), matchKind })
  }
  return found
}
