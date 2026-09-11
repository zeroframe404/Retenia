import type { Chunk, ItemBankEntry, RemediationAuthorCollected } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { CitableFragment } from '../expand/context'
import { assembleTheory, estimateMinutes, fragmentsFrom, pickBankItems } from './generate'

const AUDIT = {
  createdAt: new Date('2026-09-11T00:00:00Z'),
  updatedAt: new Date('2026-09-11T00:00:00Z'),
  deletedAt: null,
  deviceId: 'test',
  version: 1,
}

function chunk(overrides: Partial<Chunk> & { id: string }): Chunk {
  return {
    sourceId: 'src-book',
    unitId: null,
    ordinal: 0,
    text: `Fragmento ${overrides.id}`,
    charStart: 0,
    charEnd: 80,
    tokenCount: 10,
    hash: `hash-${overrides.id}`,
    headingPath: null,
    context: null,
    chunkKey: null,
    chunkingVersion: null,
    isFrontmatter: false,
    locator: { block_ids: [`${overrides.id}-b1`] },
    ...AUDIT,
    ...overrides,
  }
}

function bankEntry(overrides: Partial<ItemBankEntry> & { id: string }): ItemBankEntry {
  return {
    activityId: `act-${overrides.id}`,
    pathVersionId: 'pv1',
    moduleId: 'm1',
    usage: ['reinforcement', 'remediation'],
    difficultyLogit: 0,
    discriminationHint: null,
    exposure: 0,
    stats: {},
    authoring: { concept_ids: ['c1'] },
    ...AUDIT,
    ...overrides,
  }
}

describe('estimateMinutes()', () => {
  it('clamps a tiny detour up to the 3-minute floor', () => {
    expect(estimateMinutes(0, 0, false)).toBe(3)
  })

  it('clamps a huge detour down to the 5-minute ceiling', () => {
    expect(estimateMinutes(100_000, 50, true)).toBe(5)
  })

  it('grows with the word count', () => {
    const base = estimateMinutes(0, 0, false)
    const withWords = estimateMinutes(700, 0, false)
    expect(withWords).toBeGreaterThan(base)
  })

  it('grows with the item count', () => {
    const base = estimateMinutes(0, 0, false)
    const withItems = estimateMinutes(0, 5, false)
    expect(withItems).toBeGreaterThan(base)
  })

  it('grows with whether there is a contrast card', () => {
    const withoutCard = estimateMinutes(600, 0, false)
    const withCard = estimateMinutes(600, 0, true)
    expect(withCard).toBeGreaterThan(withoutCard)
  })
})

describe('pickBankItems()', () => {
  it('keeps only entries whose authoring.concept_ids includes the concept', () => {
    const entries = [
      bankEntry({ id: 'e1', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e2', authoring: { concept_ids: ['c2'] } }),
    ]
    const picked = pickBankItems(entries, 'c1', new Set())
    expect(picked.map((entry) => entry.id)).toEqual(['e1'])
  })

  it('keeps the input order', () => {
    const entries = [
      bankEntry({ id: 'e3', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e1', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e2', authoring: { concept_ids: ['c1'] } }),
    ]
    const picked = pickBankItems(entries, 'c1', new Set())
    expect(picked.map((entry) => entry.id)).toEqual(['e3', 'e1', 'e2'])
  })

  it('excludes by entry id and by activityId', () => {
    const entries = [
      bankEntry({ id: 'e1', activityId: 'act-1', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e2', activityId: 'act-2', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e3', activityId: 'act-3', authoring: { concept_ids: ['c1'] } }),
    ]
    const picked = pickBankItems(entries, 'c1', new Set(['e1', 'act-2']))
    expect(picked.map((entry) => entry.id)).toEqual(['e3'])
  })

  it('respects max, defaulting to the policy value of 3', () => {
    const entries = [
      bankEntry({ id: 'e1', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e2', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e3', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e4', authoring: { concept_ids: ['c1'] } }),
      bankEntry({ id: 'e5', authoring: { concept_ids: ['c1'] } }),
    ]
    expect(pickBankItems(entries, 'c1', new Set()).length).toBe(3)
    expect(pickBankItems(entries, 'c1', new Set(), 2).length).toBe(2)
  })
})

describe('fragmentsFrom()', () => {
  it('dedupes by chunk id', () => {
    const fragments = fragmentsFrom([chunk({ id: 'a' }), chunk({ id: 'a' }), chunk({ id: 'b' })])
    expect(fragments.map((fragment) => fragment.chunkId)).toEqual(['a', 'b'])
  })

  it('caps at 6 fragments and numbers cite ids B01..B06', () => {
    const chunks = Array.from({ length: 8 }, (_unused, index) => chunk({ id: `c${index}` }))
    const fragments = fragmentsFrom(chunks)
    expect(fragments.length).toBe(6)
    expect(fragments.map((fragment) => fragment.citeId)).toEqual([
      'B01',
      'B02',
      'B03',
      'B04',
      'B05',
      'B06',
    ])
  })

  it('keeps text under 1,800 chars as-is, untruncated', () => {
    const text = 'x'.repeat(1_800)
    const [fragment] = fragmentsFrom([chunk({ id: 'a', text })])
    expect(fragment?.text).toBe(text)
    expect(fragment?.truncated).toBe(false)
  })

  it('truncates text over 1,800 chars and sets truncated', () => {
    const text = 'x'.repeat(1_801)
    const [fragment] = fragmentsFrom([chunk({ id: 'a', text })])
    expect(fragment?.text).toBe(`${'x'.repeat(1_800)}…`)
    expect(fragment?.truncated).toBe(true)
  })
})

function fragment(overrides: Partial<CitableFragment> & { citeId: string }): CitableFragment {
  return {
    chunkId: `chunk-${overrides.citeId}`,
    sourceId: 'src-book',
    blockIds: [`${overrides.citeId}-b1`],
    headingPath: null,
    locator: 'p. 1',
    text: 'Some source text.',
    truncated: false,
    origin: 'mapped',
    ...overrides,
  }
}

function collected(
  blocks: RemediationAuthorCollected['blocks'],
): Pick<RemediationAuthorCollected, 'blocks'> {
  return { blocks }
}

describe('assembleTheory()', () => {
  it("keeps a cited block's citations and type", () => {
    const result = assembleTheory(
      collected([{ type: 'explanation', content: 'A claim.', citations: ['B01'] }]),
      [fragment({ citeId: 'B01' })],
      'L02.r1',
      null,
    )
    expect(result.theory.blocks).toEqual([
      {
        type: 'explanation',
        content: 'A claim.',
        citations: ['B01'],
        diagram: null,
        misconception_id: null,
      },
    ])
  })

  it('retypes an uncited explanation/worked_example to general_knowledge', () => {
    const result = assembleTheory(
      collected([
        { type: 'explanation', content: 'An unsupported claim.', citations: [] },
        { type: 'worked_example', content: 'An unsupported example.', citations: [] },
      ]),
      [fragment({ citeId: 'B01' })],
      'L02.r1',
      null,
    )
    expect(result.theory.blocks.map((block) => block.type)).toEqual([
      'general_knowledge',
      'general_knowledge',
    ])
  })

  it('drops unknown cite ids from a non-substantive block without retyping it', () => {
    const result = assembleTheory(
      collected([{ type: 'summary', content: 'A summary.', citations: ['B99'] }]),
      [fragment({ citeId: 'B01' })],
      'L02.r1',
      null,
    )
    expect(result.theory.blocks).toEqual([
      {
        type: 'summary',
        content: 'A summary.',
        citations: [],
        diagram: null,
        misconception_id: null,
      },
    ])
  })

  it('sets misconception_id only on misconception blocks', () => {
    const result = assembleTheory(
      collected([
        { type: 'misconception', content: 'Corrects X001.', citations: ['B01'] },
        { type: 'summary', content: 'Recaps it.', citations: ['B01'] },
      ]),
      [fragment({ citeId: 'B01' })],
      'L02.r1',
      'X001',
    )
    expect(result.theory.blocks[0]?.misconception_id).toBe('X001')
    expect(result.theory.blocks[1]?.misconception_id).toBeNull()
  })

  it('sums word_count across every block', () => {
    const result = assembleTheory(
      collected([
        { type: 'explanation', content: 'One two three.', citations: ['B01'] },
        { type: 'summary', content: 'Four five.', citations: ['B01'] },
      ]),
      [fragment({ citeId: 'B01' })],
      'L02.r1',
      null,
    )
    expect(result.theory.word_count).toBe(5)
  })

  it('lists only the fragments actually used as citations', () => {
    const result = assembleTheory(
      collected([{ type: 'explanation', content: 'A claim.', citations: ['B01'] }]),
      [fragment({ citeId: 'B01' }), fragment({ citeId: 'B02' })],
      'L02.r1',
      null,
    )
    expect(result.citations.map((citation) => citation.id)).toEqual(['B01'])
  })
})
