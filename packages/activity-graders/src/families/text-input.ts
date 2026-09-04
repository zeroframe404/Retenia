import {
  type Activity,
  normalizeText,
  type TextAnswer,
  textInputResponseSchema,
} from '@retenia/activity-schema'
import { GraderUnsupportedError } from '../errors'
import { numericMatches } from '../numeric/match'
import { parseNumber } from '../numeric/parse'
import { matchText } from '../text/match'
import { type AttemptMeta, result } from './shared'

/** `text_input`: FUZ for text, tolerance and units for numbers, cases for a regex the user writes. CAS math is phase 3. */
export function gradeTextInput(
  activity: Activity<'text_input'>,
  response: unknown,
  meta: AttemptMeta,
) {
  const { value } = textInputResponseSchema.parse(response)
  const { inputKind, answers, numeric, regexCases } = activity.payload
  const modelAnswer = (answers[0] as TextAnswer).value
  const plain = answers.filter((answer) => !answer.isRegex).map((answer) => answer.value)
  const regexes = answers.filter((answer) => answer.isRegex === true).map((answer) => answer.value)
  const feedbackFor = (correct: boolean, similarity: number) =>
    correct
      ? 'Correct.'
      : similarity >= 0.6
        ? `Close — expected «${modelAnswer}».`
        : `Incorrect — expected «${modelAnswer}».`
  const finish = (score: number, correct: boolean, engine: string) =>
    result(meta, {
      score,
      correct,
      perItem: [{ id: 'answer', correct, expected: modelAnswer, got: value }],
      feedback: feedbackFor(correct, score),
      meta: { engine },
    })

  switch (inputKind) {
    case 'number': {
      const parsed = parseNumber(value)
      if (parsed !== null && numeric !== undefined) {
        const tolerance = activity.grading.numeric
        const match = numericMatches(parsed, numeric.value, {
          abs: numeric.tol?.abs ?? tolerance?.absTol ?? 0,
          rel: numeric.tol?.rel ?? tolerance?.relTol ?? 0,
          ...(numeric.unit === undefined ? {} : { unit: numeric.unit }),
          ...(tolerance?.units === undefined ? {} : { units: tolerance.units }),
        })
        if (match.matched) return finish(1, true, 'numeric')
      }
      // A written form ("un cuarto") listed among the answers still counts.
      const literal = plain.some((answer) => normalizeText(answer) === normalizeText(value))
      return finish(literal ? 1 : 0, literal, 'numeric')
    }
    case 'regex': {
      let pattern: RegExp | null = null
      try {
        pattern = new RegExp(value, 'u')
      } catch {
        pattern = null
      }
      const cases = regexCases ?? []
      const passed =
        pattern === null
          ? 0
          : cases.filter((c) => (pattern as RegExp).test(c.input) === c.shouldMatch).length
      const score = cases.length === 0 ? 0 : passed / cases.length
      return finish(score, score === 1, 'regex')
    }
    case 'math':
      throw new GraderUnsupportedError('text_input with inputKind "math" (CAS, phase 3)')
    default: {
      const fuzzy = activity.grading.fuzzy
      const match = matchText(value, plain, {
        ...(fuzzy?.caseSensitive === undefined ? {} : { caseSensitive: fuzzy.caseSensitive }),
        ...(fuzzy?.ignoreDiacritics === undefined
          ? {}
          : { ignoreDiacritics: fuzzy.ignoreDiacritics }),
        ...(fuzzy?.synonyms === undefined ? {} : { synonyms: fuzzy.synonyms }),
        ...(fuzzy?.maxRelativeEditDistance === undefined
          ? {}
          : { maxRelativeEditDistance: fuzzy.maxRelativeEditDistance }),
        regexes,
      })
      return finish(match.similarity, match.matched, match.via === 'none' ? 'fuzzy' : match.via)
    }
  }
}
