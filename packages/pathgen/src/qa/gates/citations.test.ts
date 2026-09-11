import { describe, expect, it } from 'vitest'
import type { LessonCitation, TheoryBlock } from '../../schemas/lesson'
import { checkCitations } from './citations'

function block(type: TheoryBlock['type'], content: string, citations: string[] = []): TheoryBlock {
  return { type, content, citations, diagram: null, misconception_id: null }
}

function citation(id: string, quote: string | null = null): LessonCitation {
  return {
    id,
    source_id: 'src-book',
    chunk_id: `chunk-${id}`,
    block_ids: [`${id}-b1`],
    locator: 'p. 8',
    quote,
  }
}

const chunkText = new Map([
  [
    'chunk-B01',
    'La memoria de trabajo retiene unos cuatro elementos a la vez, según Cowan (2001).',
  ],
  ['chunk-B02', 'El bucle fonológico repite la información verbal en silencio.'],
])

describe('checkCitations() — §5 gate 2', () => {
  it('passes a lesson whose quotations are in the cited chunks, and stores the quote', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block(
          'explanation',
          'Según la fuente, «retiene unos cuatro elemento a la vez» [cite:B01]. Y el bucle repite [cite:B02].',
          ['B01', 'B02'],
        ),
      ],
      citations: [citation('B01'), citation('B02')],
      chunkText,
    })
    expect(result.outcome).toBe('pass')
    expect(result.findings).toEqual([])
    expect(result.blocks[0]?.citations).toEqual(['B01', 'B02'])
    // A fuzzy match at ≥ 0.85 is enough to keep the quote — stage 7 stored exact ones only.
    expect(result.citations.find((entry) => entry.id === 'B01')?.quote).toBe(
      'retiene unos cuatro elemento a la vez',
    )
  })

  it('strips the markers of a sentence whose quotation is not in the source, and flags it', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block(
          'explanation',
          'La fuente dice «retiene siete elementos a la vez» [cite:B01]. El bucle repite [cite:B02].',
          ['B01', 'B02'],
        ),
      ],
      citations: [citation('B01'), citation('B02')],
      chunkText,
    })
    expect(result.outcome).toBe('fix')
    expect(result.blocks[0]?.content).toBe(
      'La fuente dice «retiene siete elementos a la vez». El bucle repite [cite:B02].',
    )
    expect(result.blocks[0]?.citations).toEqual(['B02'])
    expect(result.findings.map((finding) => finding.kind)).toEqual(['citation_span_mismatch'])
    expect(result.findings[0]?.citation_ids).toEqual(['B01'])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['citation_span_mismatch'])
    // B01 is no longer cited anywhere, so it leaves `lessons.citations` too.
    expect(result.citations.map((entry) => entry.id)).toEqual(['B02'])
  })

  it('retypes a substantive block that loses its last citation to general knowledge', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block('misconception', 'Error típico: «retiene siete elementos a la vez» [cite:B01].', [
          'B01',
        ]),
      ],
      citations: [citation('B01')],
      chunkText,
    })
    expect(result.retyped).toBe(1)
    expect(result.blocks[0]?.type).toBe('general_knowledge')
    expect(result.blocks[0]?.citations).toEqual([])
    expect(result.blocks[0]?.misconception_id).toBeNull()
    expect(result.warnings.map((entry) => entry.code)).toContain('lesson_block_uncited')
  })

  it('withdraws the sibling list from a marker-less sentence that misquotes it', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [block('explanation', 'Dice «retiene siete elementos a la vez».', ['B01'])],
      citations: [citation('B01')],
      chunkText,
    })
    expect(result.blocks[0]?.type).toBe('general_knowledge')
    expect(result.blocks[0]?.citations).toEqual([])
  })

  it('removes an id that resolves to no stored citation', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [block('explanation', 'Uno [cite:B01, B99]. Dos.', ['B01', 'B99'])],
      citations: [citation('B01')],
      chunkText,
    })
    expect(result.blocks[0]?.content).toBe('Uno [cite:B01]. Dos.')
    expect(result.blocks[0]?.citations).toEqual(['B01'])
    expect(result.findings.map((finding) => finding.kind)).toEqual(['citation_missing'])
  })

  it('leaves a quotation alone when the cited chunk is not available to check', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block('explanation', 'Dice «algo que no podemos verificar hoy» [cite:B01].', ['B01']),
      ],
      citations: [citation('B01')],
      chunkText: new Map(),
    })
    expect(result.outcome).toBe('pass')
    expect(result.blocks[0]?.citations).toEqual(['B01'])
  })
})
