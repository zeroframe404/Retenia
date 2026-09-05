import type { TextGenerator } from '@retenia/ai'
import type { ExplainAnswer, ExplainAnswerRequest, RichText } from '@retenia/core'
import { escapeForPrompt } from './grade-long-text/task'

/**
 * §9's "Explain my answer" — *Explicame* — over a `TextGenerator`.
 *
 * The full tutor of sub-phase 9.4 has the retrieval pipeline behind it and answers follow-ups;
 * this is the narrow version the feedback panel needs today: one grade, one explanation, no
 * conversation. It runs at temperature 0 for the same reason the grader does (§7), and the
 * learner's answer is escaped and tagged rather than concatenated, so an answer that addresses
 * the model is read as text and not as a turn.
 */

export interface ExplainAnswerOptions {
  textGenerator: TextGenerator
  /** The contents of `prompts/explain_answer.md`; `loadExplainAnswerPrompt()` reads the file. */
  promptTemplate: string
  maxOutputTokens?: number
}

export const EXPLAIN_ANSWER_TEMPERATURE = 0

function block(tag: string, body: string): string {
  return `<${tag}>\n${escapeForPrompt(body)}\n</${tag}>`
}

export function buildExplainAnswerTask(input: ExplainAnswerRequest): string {
  const blocks = [
    `<question lang="${escapeForPrompt(input.activity.lang)}" type="${escapeForPrompt(input.activity.type)}">\n${escapeForPrompt(input.activity.prompt)}\n</question>`,
  ]
  const grade = input.gradeResult
  if (grade !== null) {
    const criteria = grade.perCriterion
      .map(
        (criterion) =>
          `  <criterion score="${criterion.score}">${escapeForPrompt(criterion.criterion)}${criterion.comment === undefined ? '' : ` — ${escapeForPrompt(criterion.comment)}`}</criterion>`,
      )
      .join('\n')
    blocks.push(
      `<grade score="${grade.score}" uncertain="${grade.uncertain}">\n${criteria}\n</grade>`,
      block('grader_feedback', grade.feedback),
    )
  }
  // Last, as in the grading prompt: the text under discussion, and nothing after it.
  blocks.push(block('answer', input.answer))
  return blocks.join('\n\n')
}

export function createExplainAnswer(options: ExplainAnswerOptions): ExplainAnswer {
  return async (input): Promise<RichText> => {
    const completion = await options.textGenerator({
      system: options.promptTemplate.replace('{{task}}', '').trimEnd(),
      prompt: buildExplainAnswerTask(input),
      temperature: EXPLAIN_ANSWER_TEMPERATURE,
      ...(options.maxOutputTokens === undefined
        ? {}
        : { maxOutputTokens: options.maxOutputTokens }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    return completion.text.trim()
  }
}
