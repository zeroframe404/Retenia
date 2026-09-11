import { describe, expect, it } from 'vitest'
import type { TheoryBlock } from '../../schemas/lesson'
import { checkLanguage, primarySubtag } from './language'

function block(type: TheoryBlock['type'], content: string): TheoryBlock {
  return { type, content, citations: ['B01'], diagram: null, misconception_id: null }
}

const prose = [
  block('hook', 'Al terminar vas a poder explicar la memoria de trabajo.'),
  block(
    'explanation',
    'La memoria de trabajo retiene unos cuatro elementos a la vez, como dice «working memory holds four» [cite:B01].',
  ),
]

describe('checkLanguage() — §5 gate 8', () => {
  it('compares primary subtags only', () => {
    expect(primarySubtag('es-AR')).toBe('es')
    expect(primarySubtag('EN')).toBe('en')
  })

  it('passes prose the detector reads in the lesson’s language, quotations excluded', () => {
    const seen: string[] = []
    const result = checkLanguage({
      lessonSpecId: 'L01',
      blocks: prose,
      glossary: [],
      lessonLanguage: 'es-AR',
      detectLanguage: (text) => {
        seen.push(text)
        return 'es'
      },
      mode: 'full',
    })
    expect(result.outcome).toBe('pass')
    // The quotation in English is the source's business and never reaches the detector.
    expect(seen[0]).not.toContain('working memory holds four')
    expect(seen[0]).not.toContain('[cite:')
  })

  it('flags prose in another language and asks for every substantive block to be rewritten', () => {
    const result = checkLanguage({
      lessonSpecId: 'L01',
      blocks: prose,
      glossary: [],
      lessonLanguage: 'es-AR',
      detectLanguage: () => 'en',
      mode: 'full',
    })
    expect(result.outcome).toBe('fix')
    expect(result.findings.map((finding) => finding.kind)).toEqual(['language_mismatch'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['language_mismatch'])
    expect(result.edits).toEqual([expect.objectContaining({ blockIndex: 1, source: 'language' })])
  })

  it('treats an unmapped 3-letter code as "could not tell", never as a mismatch', () => {
    const result = checkLanguage({
      lessonSpecId: 'L01',
      blocks: prose,
      glossary: [],
      lessonLanguage: 'es-AR',
      detectLanguage: () => 'glg',
      mode: 'full',
    })
    expect(result.outcome).toBe('pass')
  })

  it('flags a translated glossary term used in its source-language form', () => {
    const result = checkLanguage({
      lessonSpecId: 'L01',
      blocks: [
        block(
          'explanation',
          'La working memory retiene unos cuatro elementos a la vez [cite:B01].',
        ),
      ],
      glossary: [{ term: 'memoria de trabajo', source_language_term: 'working memory' }],
      lessonLanguage: 'es-AR',
      mode: 'full',
    })
    expect(result.findings.map((finding) => finding.kind)).toEqual(['glossary_term_mixed'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['glossary_term_mixed'])
    expect(result.edits).toEqual([expect.objectContaining({ blockIndex: 0, source: 'glossary' })])
    // The same term inside a quotation is the source speaking, not the lesson.
    const quoted = checkLanguage({
      lessonSpecId: 'L01',
      blocks: [block('explanation', 'Cowan lo llama «working memory» [cite:B01].')],
      glossary: [{ term: 'memoria de trabajo', source_language_term: 'working memory' }],
      lessonLanguage: 'es-AR',
      mode: 'full',
    })
    expect(quoted.outcome).toBe('pass')
  })

  it('is skipped with no detector and no glossary to check', () => {
    expect(
      checkLanguage({
        lessonSpecId: 'L01',
        blocks: prose,
        glossary: [],
        lessonLanguage: 'es-AR',
        mode: 'full',
      }).outcome,
    ).toBe('skipped')
  })
})
