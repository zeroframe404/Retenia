import { describe, expect, it } from 'vitest'
import type { LessonCitation, TheoryBlock } from '../../schemas/lesson'
import { applyEdits, markerList } from './edit'
import type { EditInstruction } from './types'

function block(type: TheoryBlock['type'], content: string, citations: string[] = []): TheoryBlock {
  return { type, content, citations, diagram: null, misconception_id: null }
}

const QUOTE = 'retiene unos cuatro elementos a la vez'
const citations: LessonCitation[] = [
  { id: 'B01', source_id: 'src', chunk_id: 'c1', block_ids: ['b1'], locator: 'p. 8', quote: QUOTE },
  { id: 'B02', source_id: 'src', chunk_id: 'c2', block_ids: ['b2'], locator: 'p. 9', quote: null },
]
const blocks = [
  block('hook', 'Al terminar vas a poder explicar la memoria de trabajo.'),
  block('explanation', `Según Cowan, «${QUOTE}» [cite:B01]. El bucle repite [cite:B02].`, [
    'B01',
    'B02',
  ]),
  block('summary', '- Cuatro elementos\n- Un bucle', ['B01']),
]
const edits: EditInstruction[] = [
  {
    blockIndex: 0,
    kind: 'replace',
    instruction: 'shorter',
    details: [],
    replacement: null,
    source: 'judge',
  },
  {
    blockIndex: 1,
    kind: 'replace',
    instruction: 'clearer',
    details: [],
    replacement: null,
    source: 'judge',
  },
  {
    blockIndex: 1,
    kind: 'insert_after',
    instruction: 'example',
    details: [],
    replacement: null,
    source: 'judge',
  },
  {
    blockIndex: 0,
    kind: 'delete',
    instruction: 'redundant',
    details: [],
    replacement: null,
    source: 'judge',
  },
]

/** Every verified citation, before and after — the acceptance criterion's diff assertion. */
function verifiedCitations(list: readonly TheoryBlock[]): string[] {
  return list.flatMap((entry) => markerList(entry.content))
}

describe('applyEdits() — §5 gate 10, P8 "without touching verified citations"', () => {
  it('applies a clean replacement and leaves every marker and quote byte-identical', () => {
    const before = verifiedCitations(blocks)
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits,
      output: {
        changes: [
          {
            block_index: 1,
            kind: 'replace',
            content: `Cowan midió que la memoria «${QUOTE}» [cite:B01]. Y el bucle fonológico repite lo verbal [cite:B02].`,
          },
        ],
        notes: [],
      },
    })
    expect(result.applied).toBe(1)
    expect(result.rejected).toBe(0)
    expect(result.outcome).toBe('fix')
    expect(result.blocks[1]?.content).toContain('Cowan midió')
    expect(verifiedCitations(result.blocks)).toEqual(before)
    expect(result.blocks[1]?.content).toContain(`«${QUOTE}»`)
  })

  it.each([
    ['drops a citation marker', 'Cowan midió que la memoria retiene cuatro [cite:B02].'],
    [
      'adds a citation marker',
      `Según Cowan, «${QUOTE}» [cite:B01]. El bucle repite [cite:B02, B03].`,
    ],
    [
      'moves a marker to another claim',
      `Según Cowan [cite:B02], «${QUOTE}» [cite:B01]. El bucle repite.`,
    ],
    [
      'alters a verified quotation',
      'Según Cowan, «retiene siete elementos a la vez» [cite:B01]. El bucle repite [cite:B02].',
    ],
    [
      'merges two cited sentences into one',
      `Según Cowan, «${QUOTE}» y el bucle repite [cite:B01] [cite:B02].`,
    ],
  ])('refuses a replacement that %s and keeps the original block', (_, content) => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits,
      output: { changes: [{ block_index: 1, kind: 'replace', content }], notes: [] },
    })
    expect(result.applied).toBe(0)
    expect(result.rejected).toBe(1)
    expect(result.blocks).toEqual(blocks)
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: 'edit_rejected', block_index: 1 }),
    ])
    expect(result.warnings.map((entry) => entry.code)).toEqual(['edit_rejected'])
  })

  it('admits one change per edit and refuses the surplus', () => {
    // Two separate insert_after edits at the same block: both are honoured.
    const twoInserts: EditInstruction[] = [
      ...edits,
      {
        blockIndex: 1,
        kind: 'insert_after',
        instruction: 'another example',
        details: [],
        replacement: null,
        source: 'judge',
      },
    ]
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits: twoInserts,
      output: {
        changes: [
          { block_index: 1, kind: 'insert_after', content: 'Un ejemplo para fijar la idea.' },
          { block_index: 1, kind: 'insert_after', content: 'Otro ejemplo distinto.' },
          { block_index: 1, kind: 'insert_after', content: 'Y otro más, que nadie pidió.' },
          { block_index: 1, kind: 'insert_after', content: 'Y un tercero.' },
        ],
        notes: [],
      },
    })
    expect(result.applied).toBe(2)
    expect(result.rejected).toBe(2)
    expect(result.blocks.map((entry) => entry.content)).toEqual(
      expect.arrayContaining(['Un ejemplo para fijar la idea.', 'Otro ejemplo distinto.']),
    )
    expect(result.blocks).toHaveLength(blocks.length + 2)
    expect(result.findings.map((finding) => finding.detail)).toEqual([
      'more changes than edits asked for',
      'more changes than edits asked for',
    ])
  })

  it('refuses an insertion that carries a citation marker, even with budget to spare', () => {
    const twoInserts: EditInstruction[] = [
      ...edits,
      {
        blockIndex: 1,
        kind: 'insert_after',
        instruction: 'another example',
        details: [],
        replacement: null,
        source: 'judge',
      },
    ]
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits: twoInserts,
      output: {
        changes: [
          { block_index: 1, kind: 'insert_after', content: 'Un ejemplo sin cita.' },
          { block_index: 1, kind: 'insert_after', content: 'Otro con cita [cite:B01].' },
        ],
        notes: [],
      },
    })
    expect(result.applied).toBe(1)
    expect(result.rejected).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({ block_index: 1, detail: 'inserted text may not cite' }),
    ])
  })

  it('refuses a change to a block nobody asked to edit', () => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits,
      output: {
        changes: [{ block_index: 2, kind: 'replace', content: '- Otra cosa [cite:B01]' }],
        notes: [],
      },
    })
    expect(result.rejected).toBe(1)
    expect(result.blocks).toEqual(blocks)
  })

  it('deletes only a block that carries no marker, and inserts only uncited text', () => {
    const result = applyEdits({
      lessonSpecId: 'L01',
      blocks,
      citations,
      edits: [
        ...edits,
        {
          blockIndex: 1,
          kind: 'delete',
          instruction: 'x',
          details: [],
          replacement: null,
          source: 'judge',
        },
      ],
      output: {
        changes: [
          { block_index: 0, kind: 'delete', content: '' },
          { block_index: 1, kind: 'delete', content: '' },
          {
            block_index: 1,
            kind: 'insert_after',
            content: 'Un ejemplo concreto para fijar la idea.',
          },
          { block_index: 1, kind: 'insert_after', content: 'Otro con cita [cite:B01].' },
        ],
        notes: [],
      },
    })
    expect(result.applied).toBe(2)
    expect(result.rejected).toBe(2)
    expect(result.blocks.map((entry) => entry.type)).toEqual([
      'explanation',
      'general_knowledge',
      'summary',
    ])
    expect(result.blocks[1]?.content).toBe('Un ejemplo concreto para fijar la idea.')
    expect(result.blocks[1]?.citations).toEqual([])
    expect(verifiedCitations(result.blocks)).toEqual(verifiedCitations(blocks))
  })
})
