import { describe, expect, it } from 'vitest'
import { SUBSTANTIVE_BLOCK_TYPES, type WriteLessonOutput } from '../schemas/lesson'
import { resolveCitations } from './citations'
import type { CitableFragment, LessonContext } from './context'

function fragment(citeId: string, text: string): CitableFragment {
  return {
    citeId,
    chunkId: `chunk-${citeId}`,
    sourceId: 'src-book',
    blockIds: [`${citeId}-b1`, `${citeId}-b2`],
    headingPath: 'Libro > Cap. 2',
    locator: 'p. 8',
    text,
    origin: 'mapped',
  }
}

const context: LessonContext = {
  citable: [
    fragment('B01', 'La memoria de trabajo retiene unos cuatro elementos a la vez.'),
    fragment('B02', 'El bucle fonológico repite la información verbal.'),
  ],
  previous: [],
  glossary: [],
  sourceTokens: 0,
  trimmed: 0,
  warnings: [],
}

function output(blocks: WriteLessonOutput['blocks']): WriteLessonOutput {
  return { blocks, glossary: [], word_count: 100, warnings: [] }
}

function block(
  type: WriteLessonOutput['blocks'][number]['type'],
  content: string,
  citations: string[] = [],
): WriteLessonOutput['blocks'][number] {
  return { type, content, citations, diagram: null, misconception_id: null }
}

describe('resolveCitations()', () => {
  it('resolves a cited block to the fragment’s real block ids', () => {
    const resolved = resolveCitations(
      output([block('explanation', 'La capacidad es limitada. [cite:B01]', ['B01'])]),
      context,
      'L01',
    )
    expect(resolved.blocks[0]?.type).toBe('explanation')
    expect(resolved.blocks[0]?.citations).toEqual(['B01'])
    expect(resolved.citations).toEqual([
      {
        id: 'B01',
        source_id: 'src-book',
        chunk_id: 'chunk-B01',
        block_ids: ['B01-b1', 'B01-b2'],
        locator: 'p. 8',
        quote: null,
      },
    ])
  })

  it('takes the union of the inline markers and the sibling array', () => {
    const resolved = resolveCitations(
      output([block('explanation', 'Uno. [cite:B02]', ['B01'])]),
      context,
      'L01',
    )
    expect(resolved.blocks[0]?.citations.toSorted()).toEqual(['B01', 'B02'])
  })

  it('drops an id that names no fragment, and its marker with it', () => {
    const resolved = resolveCitations(
      output([block('explanation', 'Uno. [cite:B01, B99] Dos.', [])]),
      context,
      'L01',
    )
    expect(resolved.blocks[0]?.citations).toEqual(['B01'])
    expect(resolved.blocks[0]?.content).toContain('[cite:B01]')
    expect(resolved.blocks[0]?.content).not.toContain('B99')
    expect(resolved.dropped).toEqual(['B99'])
    expect(resolved.warnings.map((entry) => entry.code)).toContain('citation_unresolved')
  })

  it('retypes an uncited substantive block to general_knowledge rather than deleting it', () => {
    const resolved = resolveCitations(
      output([block('worked_example', 'Un ejemplo sin fuente.', [])]),
      context,
      'L01',
    )
    expect(resolved.blocks[0]?.type).toBe('general_knowledge')
    expect(resolved.blocks[0]?.content).toBe('Un ejemplo sin fuente.')
    expect(resolved.uncited).toBe(1)
    expect(resolved.warnings.map((entry) => entry.code)).toContain('lesson_block_uncited')
  })

  it('leaves the framing blocks alone: they assert nothing', () => {
    const resolved = resolveCitations(
      output([
        block('hook', '¿Por qué olvidás un número de teléfono?'),
        block('activation_question', '¿Qué vimos en L00?'),
        block('summary', 'Tres puntos.'),
        block('glossary', 'Memoria de trabajo.'),
      ]),
      context,
      'L01',
    )
    expect(resolved.blocks.map((entry) => entry.type)).toEqual([
      'hook',
      'activation_question',
      'summary',
      'glossary',
    ])
    expect(resolved.uncited).toBe(0)
  })

  /** The sub-phase's acceptance criterion, stated as the property it actually is. */
  it('leaves every substantive block with a citation that resolves to a real block', () => {
    const resolved = resolveCitations(
      output([
        block('explanation', 'Con fuente. [cite:B01]', ['B01']),
        block('example', 'Sin fuente.', ['B99']),
        block('misconception', 'Error típico. [cite:B02]', []),
      ]),
      context,
      'L01',
    )
    const known = new Set(context.citable.map((entry) => entry.citeId))
    for (const entry of resolved.blocks) {
      if (entry.type === 'general_knowledge') continue
      if (entry.type === 'hook' || entry.type === 'summary') continue
      expect(entry.citations.length).toBeGreaterThan(0)
      for (const id of entry.citations) expect(known.has(id)).toBe(true)
    }
  })

  it('keeps a verbatim quote only when the fragment contains it', () => {
    const resolved = resolveCitations(
      output([
        block('explanation', 'Como dice: «retiene unos cuatro elementos a la vez». [cite:B01]', [
          'B01',
        ]),
        block('example', 'Y aquí: «esto no está en la fuente en absoluto». [cite:B02]', ['B02']),
      ]),
      context,
      'L01',
    )
    expect(resolved.citations[0]?.quote).toBe('retiene unos cuatro elementos a la vez')
    expect(resolved.citations[1]?.quote).toBeNull()
  })
})

describe('resolveCitations() — blocks that cannot survive resolution', () => {
  it('drops a block whose whole content was a marker naming no fragment', () => {
    const resolved = resolveCitations(
      output([
        block('explanation', '[cite:B99]'),
        block('summary', 'Queda esto. [cite:B01]', ['B01']),
      ]),
      context,
      'L01',
    )

    // Not an empty-content block written to the column — `theoryBlockSchema` rejects those,
    // and nothing re-parses the theory between here and `persistTheory`.
    expect(resolved.blocks).toHaveLength(1)
    expect(resolved.blocks.every((entry) => entry.content !== '')).toBe(true)
  })

  it('clears misconception_id when a misconception block is retyped', () => {
    const resolved = resolveCitations(
      output([
        {
          ...block('misconception', 'Mucha gente cree otra cosa.'),
          misconception_id: 'X001',
        },
      ]),
      context,
      'L01',
    )

    const [only] = resolved.blocks
    expect(only?.type).toBe('general_knowledge')
    // A "not from your sources" block must not keep pointing at a real misconception.
    expect(only?.misconception_id).toBeNull()
  })

  it.each(SUBSTANTIVE_BLOCK_TYPES)('retypes an uncited %s block', (type) => {
    const resolved = resolveCitations(
      output([block(type, 'Una afirmación sin respaldo.')]),
      context,
      'L01',
    )

    expect(resolved.blocks[0]?.type).toBe('general_knowledge')
    expect(resolved.uncited).toBe(1)
  })
})
