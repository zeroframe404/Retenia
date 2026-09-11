import { describe, expect, it } from 'vitest'
import type { TheoryBlock } from '../../schemas/lesson'
import { checkLength, THEORY_WORDS, theoryWordCount } from './length'

function block(type: TheoryBlock['type'], words: number): TheoryBlock {
  return {
    type,
    content: `${Array.from({ length: words }, (_, index) => `palabra${index}`).join(' ')} [cite:B01]`,
    citations: ['B01'],
    diagram: null,
    misconception_id: null,
  }
}

describe('checkLength() — §5 gate 7', () => {
  it('counts words without the markers and passes §4’s 600–1,200 band', () => {
    const blocks = [block('hook', 50), block('explanation', 400), block('summary', 200)]
    expect(theoryWordCount(blocks)).toBe(650)
    expect(checkLength({ lessonSpecId: 'L01', blocks, mode: 'full' }).outcome).toBe('pass')
  })

  it('flags a thin lesson and asks nothing of the editor, which may not add claims', () => {
    const result = checkLength({
      lessonSpecId: 'L01',
      blocks: [block('explanation', 300)],
      mode: 'full',
    })
    expect(result.outcome).toBe('fix')
    expect(result.edits).toEqual([])
    expect(result.findings).toEqual([expect.objectContaining({ kind: 'theory_length' })])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['theory_length'])
    expect(result.warnings[0]?.params).toMatchObject({ words: 300, max: THEORY_WORDS.max })
  })

  it('asks the editor to shorten the longest substantive block of a long lesson', () => {
    const blocks = [block('hook', 100), block('explanation', 900), block('example', 500)]
    const full = checkLength({ lessonSpecId: 'L01', blocks, mode: 'full' })
    expect(full.edits).toEqual([
      expect.objectContaining({ blockIndex: 1, kind: 'replace', source: 'length' }),
    ])
    const light = checkLength({ lessonSpecId: 'L01', blocks, mode: 'light' })
    expect(light.edits).toEqual([])
    expect(light.outcome).toBe('fix')
  })
})
