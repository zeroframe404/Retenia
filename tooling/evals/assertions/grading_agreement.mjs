/**
 * Scores a grading item against `hand-labelled-grades.json`'s human label
 * (`docs/spec/06-ai-providers.md` §6: "grading agreement vs. a hand-labelled set").
 *
 * The model was asked (`datasets/grading-agreement.es.json`'s prompt) for exactly one word,
 * "correcta" or "incorrecta"; this only has to read that word back, not parse free text.
 */
export default function gradingAgreement(output, context) {
  const expected = context.vars.expected_grade
  const text = String(output).toLowerCase()

  const saidCorrect = text.includes('correcta') && !text.includes('incorrecta')
  const saidIncorrect = text.includes('incorrecta')
  const said = saidIncorrect ? 'incorrect' : saidCorrect ? 'correct' : 'unclear'

  const pass = said === expected
  return {
    pass,
    score: pass ? 1 : 0,
    reason: `the model said "${said}" (raw: ${JSON.stringify(output)}), the hand label is "${expected}"`,
  }
}
