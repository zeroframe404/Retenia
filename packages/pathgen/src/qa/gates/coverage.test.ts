import { describe, expect, it } from 'vitest'
import type { ConceptFacts } from '../../expand/plan'
import type { TheoryBlock } from '../../schemas/lesson'
import { checkCoverage } from './coverage'

function block(content: string): TheoryBlock {
  return { type: 'explanation', content, citations: ['B01'], diagram: null, misconception_id: null }
}

function concept(
  id: string,
  name: string,
  importance: number,
  aliases: string[] = [],
): ConceptFacts {
  return { id, name, definition: 'def', kind: 'concept', aliases, importance }
}

describe('checkCoverage() — §5 gate 4', () => {
  it('flags an important concept the lesson never names', () => {
    const result = checkCoverage({
      lessonSpecId: 'L01',
      concepts: [concept('c1', 'Memoria de trabajo', 0.9), concept('c2', 'Bucle fonológico', 0.7)],
      blocks: [block('La memoria de trabajo retiene unos cuatro elementos. [cite:B01]')],
      activities: [],
    })
    expect(result.coverageOk).toBe(false)
    expect(result.uncovered).toEqual(['c2'])
    expect(result.outcome).toBe('fix')
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'concept_uncovered', sentence: 'Bucle fonológico' }),
    ])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['concept_uncovered'])
    // Report-only: nothing an editor could add without inventing a claim.
    expect(result.edits).toEqual([])
  })

  it('accepts an alias, a mention in the practice block, and ignores accents and articles', () => {
    const result = checkCoverage({
      lessonSpecId: 'L01',
      concepts: [
        concept('c1', 'Memoria de trabajo', 0.9, ['memoria operativa']),
        concept('c2', 'Bucle fonológico', 0.7),
      ],
      blocks: [block('La MEMORIA OPERATIVA retiene poco. [cite:B01]')],
      activities: [{ config: { prompt: '¿Qué hace el bucle fonologico?' } }],
    })
    expect(result.coverageOk).toBe(true)
    expect(result.outcome).toBe('pass')
  })

  it('ignores concepts under the importance threshold, and is skipped with none above it', () => {
    const result = checkCoverage({
      lessonSpecId: 'L01',
      concepts: [concept('c3', 'Anécdota', 0.2)],
      blocks: [block('Nada que ver. [cite:B01]')],
      activities: [],
    })
    expect(result.outcome).toBe('skipped')
    expect(result.coverageOk).toBe(true)
  })
})
