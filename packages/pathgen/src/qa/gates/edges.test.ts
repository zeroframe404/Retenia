import { describe, expect, it } from 'vitest'
import type { LessonCitation, TheoryBlock } from '../../schemas/lesson'
import { extractClaims } from '../claims'
import { checkCitations } from './citations'
import { checkCoverage } from './coverage'
import { checkDuplicates, type DuplicateItem } from './duplicates'
import { applyEdits } from './edit'
import { applyFaithfulness } from './faithfulness'
import { applyJudge } from './judge'
import { checkLanguage } from './language'
import { checkLength } from './length'
import { checkSchema } from './schema'
import { clip } from './types'
import { checkVariety } from './variety'

/**
 * The edges of the gates: the branches a planted defect does not reach — a second citation
 * that matches better, a chunk that is not loaded, a model that repeats a criterion, an
 * empty change. The gates are held to full coverage (root `vitest.config.ts`) because they
 * are the "code validates" half of §5, and these are the cases that keep that honest.
 */

function block(
  type: TheoryBlock['type'],
  content: string,
  citations: string[] = [],
  diagram: TheoryBlock['diagram'] = null,
): TheoryBlock {
  return { type, content, citations, diagram, misconception_id: null }
}

function citation(id: string, chunkId = `chunk-${id}`): LessonCitation {
  return { id, source_id: 'src', chunk_id: chunkId, block_ids: ['b'], locator: 'p. 1', quote: null }
}

const unit = (values: readonly number[]): Float32Array => {
  const norm = Math.hypot(...values)
  return Float32Array.from(values.map((value) => value / norm))
}

describe('checkCitations() edges', () => {
  it('keeps the best-matching of two cited chunks, and the longest of two matching quotes', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block(
          'explanation',
          'Dice «retiene unos cuatro elementos» y luego «retiene unos cuatro elementos a la vez» [cite:B01, B02].',
          ['B01', 'B02'],
        ),
      ],
      citations: [citation('B01'), citation('B02')],
      chunkText: new Map([
        ['chunk-B01', 'Nada que ver con la memoria en absoluto.'],
        ['chunk-B02', 'La memoria de trabajo retiene unos cuatro elementos a la vez.'],
      ]),
    })
    expect(result.outcome).toBe('pass')
    expect(result.citations.find((entry) => entry.id === 'B02')?.quote).toBe(
      'retiene unos cuatro elementos a la vez',
    )
    expect(result.citations.find((entry) => entry.id === 'B01')?.quote).toBeNull()
  })

  it('skips the chunk that is not loaded and judges by the one that is', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block('explanation', 'Dice «retiene unos cuatro elementos» [cite:B01, B02].', [
          'B01',
          'B02',
        ]),
      ],
      citations: [citation('B01'), citation('B02')],
      chunkText: new Map([['chunk-B02', 'La memoria retiene unos cuatro elementos.']]),
    })
    expect(result.outcome).toBe('pass')
    expect(result.blocks[0]?.citations).toEqual(['B01', 'B02'])
  })

  it('keeps the original text of a block that was nothing but an unknown marker', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [block('hook', '[cite:B99]', ['B99']), block('explanation', '[cite:B99]', ['B99'])],
      citations: [],
      chunkText: new Map(),
    })
    expect(result.blocks[0]).toMatchObject({ type: 'hook', content: '[cite:B99]', citations: [] })
    expect(result.blocks[1]).toMatchObject({ type: 'general_knowledge', content: '[cite:B99]' })
    expect(result.retyped).toBe(1)
  })
})

describe('checkCoverage() edges', () => {
  it('reads a diagram’s alt text, and never matches a name too short to be a key', () => {
    const result = checkCoverage({
      lessonSpecId: 'L01',
      concepts: [
        {
          id: 'c1',
          name: 'Bucle fonológico',
          definition: '',
          kind: 'concept',
          aliases: [],
          importance: 0.9,
        },
        { id: 'c2', name: 'ai', definition: '', kind: 'concept', aliases: [], importance: 0.9 },
      ],
      blocks: [
        block('diagram', 'El esquema.', ['B01'], {
          kind: 'table',
          code: '| a |',
          alt_text: 'El bucle fonológico y el aire',
        }),
      ],
      activities: [],
    })
    expect(result.uncovered).toEqual(['c2'])
  })
})

describe('checkDuplicates() edges', () => {
  const item = (id: string, lesson: string, text: string): DuplicateItem => ({
    kind: 'activity',
    id,
    lessonSpecId: lesson,
    text,
  })

  it('keeps the first of two identical others, and treats a short embedding answer as "could not embed"', async () => {
    // `pregunta embebida` is already known to be unembeddable; the provider then answers one
    // vector for three texts, so only the first gets one and nothing can be compared.
    const vectors = new Map<string, Float32Array | null>([['pregunta embebida', null]])
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('a3', 'L03', 'Otra pregunta'), item('a4', 'L03', 'Pregunta embebida')],
      others: [
        item('a1', 'L01', 'Segunda pregunta'),
        item('a2', 'L02', 'Segunda pregunta'),
        item('a5', 'L02', 'Distinta'),
      ],
      embeddings: { embed: async () => [unit([1, 0])] },
      vectors,
    })
    expect(result.duplicates).toEqual([])
    expect(result.outcome).toBe('pass')
    expect(vectors.get('otra pregunta')).not.toBeNull()
    expect(vectors.get('segunda pregunta')).toBeNull()
  })

  it('keeps the closest of several near neighbours, and embeds nothing already known', async () => {
    const vectors = new Map<string, Float32Array | null>([
      ['otra pregunta', unit([1, 0])],
      ['segunda pregunta', unit([0.99, 0.14])],
      ['casi la misma', unit([0.999, 0.04])],
    ])
    let embedded = 0
    const result = await checkDuplicates({
      lessonSpecId: 'L03',
      own: [item('a3', 'L03', 'Otra pregunta')],
      others: [item('a1', 'L01', 'Segunda pregunta'), item('a2', 'L02', 'Casi la misma')],
      embeddings: {
        embed: async (texts) => {
          embedded += texts.length
          return []
        },
      },
      vectors,
    })
    expect(embedded).toBe(0)
    expect(result.duplicates).toEqual([
      expect.objectContaining({ of: expect.objectContaining({ id: 'a2' }) }),
    ])
  })
})

describe('applyEdits() edges', () => {
  const blocks = [block('hook', 'Un gancho.'), block('explanation', 'Uno [cite:B01].', ['B01'])]
  const edits = [
    {
      blockIndex: 1,
      kind: 'replace' as const,
      instruction: 'x',
      details: [],
      replacement: null,
      source: 'judge' as const,
    },
    {
      blockIndex: 0,
      kind: 'insert_after' as const,
      instruction: 'x',
      details: [],
      replacement: null,
      source: 'judge' as const,
    },
  ]

  it('refuses an empty replacement and an empty insertion', () => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations: [citation('B01')],
      edits,
      output: {
        changes: [
          { block_index: 1, kind: 'replace', content: '   ' },
          { block_index: 0, kind: 'insert_after', content: '' },
        ],
        notes: [],
      },
    })
    expect(result.applied).toBe(0)
    expect(result.rejected).toBe(2)
    expect(result.outcome).toBe('skipped')
  })

  it('passes when the model returned nothing at all', () => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations: [],
      edits,
      output: { changes: [], notes: ['nothing to do'] },
    })
    expect(result.outcome).toBe('pass')
    expect(result.blocks).toEqual(blocks)
  })
})

describe('applyFaithfulness() edges', () => {
  it('strips two struck sentences of one block in the right order', () => {
    const blocks = [
      block(
        'explanation',
        'Primera afirmación larga y verificable. [cite:B01] Segunda afirmación larga y verificable. [cite:B01] Tercera afirmación larga y verificable. [cite:B02]',
        ['B01', 'B02'],
      ),
    ]
    const claims = extractClaims(blocks)
    const result = applyFaithfulness({
      lessonSpecId: 'L01',
      blocks,
      claims,
      output: {
        claims: claims.map((claim, index) => ({
          id: claim.id,
          verdict: index < 2 ? 'unsupported' : 'supported',
          citation_id: 'B01',
          sources_differ: false,
          differing_citation_ids: [],
          note: 'no',
        })),
      },
      mode: 'full',
    })
    expect(result.blocks[0]?.content).toBe(
      'Primera afirmación larga y verificable. Segunda afirmación larga y verificable. Tercera afirmación larga y verificable. [cite:B02]',
    )
    expect(result.blocks[0]?.citations).toEqual(['B02'])
  })
})

describe('applyJudge() edges', () => {
  it('takes the first score of a repeated criterion and judges an unnamed answerer', () => {
    const result = applyJudge({
      lessonSpecId: 'L01',
      output: {
        criteria: [
          { id: 'clarity', score: 5, rationale: 'a' },
          { id: 'clarity', score: 1, rationale: 'b' },
          { id: 'alignment', score: 3, rationale: 'c' },
        ],
        overall: 4,
        edits: [],
      },
      answeredBy: '',
      generatorModel: 'claude-sonnet-5',
      blockCount: 2,
    })
    expect(result.criteria).toEqual([
      { id: 'clarity', score: 5 },
      { id: 'alignment', score: 3 },
    ])
    expect(result.pedagogyScore).toBe(4)
  })
})

describe('checkLanguage() edges', () => {
  const prose = [
    block(
      'explanation',
      'La memoria de trabajo retiene unos cuatro elementos a la vez, según Cowan.',
      ['B01'],
    ),
  ]

  it('passes when the detector cannot tell, and skips text too short to detect', () => {
    expect(
      checkLanguage({
        lessonSpecId: 'L01',
        blocks: prose,
        glossary: [],
        lessonLanguage: 'es',
        detectLanguage: () => null,
        mode: 'full',
      }).outcome,
    ).toBe('pass')
    let called = false
    const short = checkLanguage({
      lessonSpecId: 'L01',
      blocks: [block('explanation', 'Corto. [cite:B01]', ['B01'])],
      glossary: [],
      lessonLanguage: 'es',
      detectLanguage: () => {
        called = true
        return 'en'
      },
      mode: 'full',
    })
    expect(called).toBe(false)
    expect(short.outcome).toBe('skipped')
  })

  it('flags without edits in light mode, and ignores a glossary term equal to its source form', () => {
    const light = checkLanguage({
      lessonSpecId: 'L01',
      blocks: [
        block('explanation', 'The working memory holds about four items at a time, says Cowan.', [
          'B01',
        ]),
      ],
      glossary: [
        { term: 'Cowan', source_language_term: 'cowan' },
        { term: 'memoria', source_language_term: '   ' },
        { term: 'memoria de trabajo', source_language_term: 'working memory' },
      ],
      lessonLanguage: 'es-AR',
      detectLanguage: () => 'en',
      mode: 'light',
    })
    expect(light.findings.map((finding) => finding.kind)).toEqual([
      'language_mismatch',
      'glossary_term_mixed',
    ])
    expect(light.edits).toEqual([])
  })
})

describe('checkLength() edges', () => {
  it('has no block to shorten when a long lesson has no substantive block', () => {
    const words = Array.from({ length: 1_300 }, (_, index) => `w${index}`).join(' ')
    const result = checkLength({
      lessonSpecId: 'L01',
      blocks: [block('hook', words)],
      mode: 'full',
    })
    expect(result.outcome).toBe('fix')
    expect(result.edits).toEqual([])
  })
})

describe('checkSchema() edges', () => {
  it('asks for a regeneration over a theory the gates cannot read', () => {
    const result = checkSchema({ version: 2, blocks: 'nope' }, 'L01')
    expect(result.outcome).toBe('regenerate')
    expect(result.theory).toBeNull()
    expect(result.warnings.map((entry) => entry.code)).toEqual(['qa_failed'])
    expect(result.warnings[0]?.params).toMatchObject({ lesson: 'L01', gate: 'schema' })
  })
})

describe('clip()', () => {
  it('collapses whitespace and cuts with an ellipsis at the bound', () => {
    expect(clip('  a   b  ', 10)).toBe('a b')
    expect(clip('x'.repeat(12), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('checkVariety() edges', () => {
  it('ignores a module activity with no Bloom level when counting the levels', () => {
    const activities = [
      { type: 'mcq_single', bloom: 'remember' as const },
      { type: 'cloze_typed', bloom: 'understand' as const },
      { type: 'short_answer', bloom: 'apply' as const },
      { type: 'free_recall', bloom: null },
    ]
    const result = checkVariety({
      lessonSpecId: 'L01',
      activities,
      module: { specId: 'M01', activities },
    })
    expect(result.outcome).toBe('pass')
  })
})

describe('the last three branches', () => {
  it('keeps the first citation when the second one matches the quotation worse', () => {
    const result = checkCitations({
      lessonSpecId: 'L01',
      blocks: [
        block('explanation', 'Dice «retiene unos cuatro elementos» [cite:B02, B01].', [
          'B02',
          'B01',
        ]),
      ],
      citations: [citation('B01'), citation('B02')],
      chunkText: new Map([
        ['chunk-B01', 'Nada que ver con la memoria en absoluto.'],
        ['chunk-B02', 'La memoria de trabajo retiene unos cuatro elementos a la vez.'],
      ]),
    })
    expect(result.citations.find((entry) => entry.id === 'B02')?.quote).toBe(
      'retiene unos cuatro elementos',
    )
  })

  it('inserts after a non-substantive block with that block’s own type', () => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks: [block('hook', 'Un gancho.'), block('explanation', 'Uno [cite:B01].', ['B01'])],
      citations: [citation('B01')],
      edits: [
        {
          blockIndex: 0,
          kind: 'insert_after',
          instruction: 'x',
          details: [],
          replacement: null,
          source: 'judge',
        },
      ],
      output: {
        changes: [{ block_index: 0, kind: 'insert_after', content: 'Otro gancho más.' }],
        notes: [],
      },
    })
    expect(result.blocks.map((entry) => entry.type)).toEqual(['hook', 'hook', 'explanation'])
  })

  it('skips a glossary entry that was never translated', () => {
    const result = checkLanguage({
      lessonSpecId: 'L01',
      blocks: [
        block('explanation', 'La memoria de trabajo retiene unos cuatro elementos.', ['B01']),
      ],
      glossary: [{ term: 'memoria de trabajo', source_language_term: null }],
      lessonLanguage: 'es-AR',
      mode: 'full',
    })
    expect(result.outcome).toBe('pass')
  })
})
