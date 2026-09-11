import { describe, expect, it } from 'vitest'
import type { PedagogyJudgeOutput } from '../../schemas/qa'
import { applyJudge, JUDGE_REGENERATE, meanScore } from './judge'

function output(scores: number[], edits: PedagogyJudgeOutput['edits'] = []): PedagogyJudgeOutput {
  const ids = [
    'clarity',
    'examples_correct',
    'cognitive_load',
    'alignment',
    'misconceptions',
  ] as const
  return {
    criteria: scores.map((score, index) => ({
      id: ids[index] as (typeof ids)[number],
      score,
      rationale: 'r',
    })),
    overall: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    edits,
  }
}

describe('applyJudge() — §5 gate 9', () => {
  it('scores the mean of the criteria, not the model’s overall, and passes with no edits', () => {
    const result = applyJudge({
      lessonSpecId: 'L01',
      output: { ...output([4, 5, 4, 4, 5]), overall: 3 },
      answeredBy: 'gemini-3.7-flash',
      generatorModel: 'claude-sonnet-5',
      blockCount: 3,
    })
    expect(result.pedagogyScore).toBe(4.4)
    expect(result.overall).toBe(3)
    expect(result.outcome).toBe('pass')
    expect(meanScore([])).toBeNull()
  })

  it('discards a verdict the lesson’s own author produced (§14 pitfall 16)', () => {
    const result = applyJudge({
      lessonSpecId: 'L01',
      output: output([5, 5, 5, 5, 5]),
      answeredBy: 'claude-sonnet-5',
      generatorModel: 'claude-sonnet-5',
      blockCount: 3,
    })
    expect(result.outcome).toBe('skipped')
    expect(result.pedagogyScore).toBeNull()
    expect(result.warnings.map((entry) => entry.code)).toEqual(['judge_same_as_generator'])
  })

  it('asks for a regeneration under 3 and lists no edits for it', () => {
    const result = applyJudge({
      lessonSpecId: 'L01',
      output: output(
        [2, 3, 2, 3, 2],
        [{ block_index: 0, kind: 'replace', instruction: 'x', replacement: 'y' }],
      ),
      answeredBy: 'gemini-3.7-flash',
      generatorModel: 'claude-sonnet-5',
      blockCount: 3,
    })
    expect(result.pedagogyScore).toBe(2.4)
    expect(result.pedagogyScore).toBeLessThan(JUDGE_REGENERATE)
    expect(result.outcome).toBe('regenerate')
    expect(result.edits).toEqual([])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['lesson_below_threshold'])
  })

  it('turns the edits into instructions for P8 and drops one naming a block that does not exist', () => {
    const result = applyJudge({
      lessonSpecId: 'L01',
      output: output(
        [3, 4, 3, 4, 3],
        [
          {
            block_index: 1,
            kind: 'replace',
            instruction: 'Define the term first.',
            replacement: 'text',
          },
          { block_index: 9, kind: 'delete', instruction: 'gone', replacement: null },
        ],
      ),
      answeredBy: 'gemini-3.7-flash',
      generatorModel: 'claude-sonnet-5',
      blockCount: 3,
    })
    expect(result.outcome).toBe('fix')
    expect(result.edits).toEqual([
      {
        blockIndex: 1,
        kind: 'replace',
        instruction: "Apply the pedagogy reviewer's instruction given as `instruction`.",
        details: [{ label: 'instruction', text: 'Define the term first.' }],
        replacement: 'text',
        source: 'judge',
      },
    ])
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'judge_edit', block_index: 1 }),
    ])
  })
})
