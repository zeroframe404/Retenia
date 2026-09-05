import type { AiGradeInput, GradingRubricCriterion } from '@retenia/core'

/**
 * The `{{task}}` block of `prompts/grade_long_text.md`: the activity, the rubric, the reference
 * and the learner's answer, rendered as tagged sections.
 *
 * Two rules govern it.
 *
 * **The answer is data.** Every value that came from the learner — and every value that came
 * from the generator, since a generated activity is itself model output — is escaped, so no
 * amount of `</answer><system>` closes a section it did not open. That is the mechanical half of
 * §12's injection guard; the pre-grader's `sanitizeGradeInput` is the other half, which decides
 * *what* the model gets to see.
 *
 * **The order is the caller's.** §12 asks for the answer to be graded "twice with the criteria
 * permuted", so the rubric arrives already in the order this call should present it, and this
 * module never reorders anything on its own — a builder that shuffled would make the two runs
 * incomparable.
 */

/** The escape is deliberately blunt: the prompt is tagged text, not XML, and losing a literal
 *  `<` in a learner's answer about generics costs nothing next to a closed section. */
export function escapeForPrompt(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function section(tag: string, body: string, attributes: Record<string, string> = {}): string {
  const attrs = Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeForPrompt(value)}"`)
    .join('')
  return `<${tag}${attrs}>\n${body}\n</${tag}>`
}

function rubricSection(rubric: readonly GradingRubricCriterion[]): string {
  const body = rubric
    .map((criterion) => {
      const levels = criterion.levels
        .map(
          (level) =>
            `    <level score="${level.score}">${escapeForPrompt(level.description)}</level>`,
        )
        .join('\n')
      return [
        `  <criterion id="${escapeForPrompt(criterion.id)}" weight="${criterion.weight ?? 1}">`,
        `    <name>${escapeForPrompt(criterion.criterion)}</name>`,
        levels,
        '  </criterion>',
      ].join('\n')
    })
    .join('\n')
  return section('rubric', body)
}

/** Builds the task block. `lang` is stated explicitly because the feedback must come back in it. */
export function buildGradeLongTextTask(input: AiGradeInput): string {
  const blocks: string[] = [
    section('question', escapeForPrompt(input.activity.prompt), {
      lang: input.activity.lang,
      type: input.activity.type,
    }),
  ]

  if (input.activity.instructions !== undefined) {
    blocks.push(section('instructions', escapeForPrompt(input.activity.instructions)))
  }
  if (input.minWords !== undefined || input.maxWords !== undefined) {
    blocks.push(
      section(
        'length',
        `minimum words: ${input.minWords ?? 'none'}; maximum words: ${input.maxWords ?? 'none'}`,
      ),
    )
  }
  if (input.rubric !== undefined && input.rubric.length > 0) {
    blocks.push(rubricSection(input.rubric))
  }
  if (input.keyPoints !== undefined && input.keyPoints.length > 0) {
    blocks.push(
      section(
        'key_points',
        input.keyPoints
          .map(
            (point) =>
              `  <point id="${escapeForPrompt(point.id)}" weight="${point.weight ?? 1}">${escapeForPrompt(point.text)}</point>`,
          )
          .join('\n'),
      ),
    )
  }
  if (input.reference !== undefined) {
    blocks.push(section('reference', escapeForPrompt(input.reference)))
  }
  if (input.sources !== undefined && input.sources.length > 0) {
    blocks.push(
      section(
        'sources',
        input.sources
          .map(
            (source) =>
              `  <source id="${escapeForPrompt(source.id)}"${source.locator === undefined ? '' : ` locator="${escapeForPrompt(source.locator)}"`}>${escapeForPrompt(source.quote)}</source>`,
          )
          .join('\n'),
      ),
    )
  }
  if (input.mustInclude !== undefined && input.mustInclude.length > 0) {
    blocks.push(
      section(
        'must_include',
        input.mustInclude.map((item) => `- ${escapeForPrompt(item)}`).join('\n'),
      ),
    )
  }
  if (input.mustNot !== undefined && input.mustNot.length > 0) {
    blocks.push(
      section('must_not', input.mustNot.map((item) => `- ${escapeForPrompt(item)}`).join('\n')),
    )
  }

  // Last, and always: whatever a prompt's final block says carries the most weight, and what
  // should carry the most weight here is the text to be graded — not anything inside it.
  blocks.push(section('answer', escapeForPrompt(input.answer)))
  return blocks.join('\n\n')
}

/**
 * §12's permutation: the same criteria in a different order, so the second run cannot simply
 * repeat the first's position bias.
 *
 * Reversal rather than a shuffle, because §7 asks for reproducibility wherever the code can
 * supply it: two runs of the same answer must produce the same two prompts.
 */
export function permuteRubric(input: AiGradeInput): AiGradeInput {
  if (input.rubric === undefined || input.rubric.length < 2) return input
  return { ...input, rubric: [...input.rubric].reverse() }
}
