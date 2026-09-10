import { describe, expect, it } from 'vitest'
import type { Flashcard } from '../schemas/flashcards'
import type { CitableFragment, LessonContext } from './context'
import {
  dedupeByEmbedding,
  effectiveImportance,
  frontKey,
  frontOf,
  toMemoryItems,
} from './flashcards'

const fragment: CitableFragment = {
  citeId: 'B01',
  chunkId: 'chunk-1',
  sourceId: 'src-book',
  blockIds: ['b1', 'b2'],
  headingPath: 'Libro > Cap. 2',
  locator: 'p. 8',
  text: 'La memoria de trabajo retiene unos cuatro elementos.',
  origin: 'mapped',
}

const context: LessonContext = {
  citable: [fragment],
  previous: [],
  glossary: [],
  sourceTokens: 0,
  trimmed: 0,
  warnings: [],
}

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    type: 'basic',
    front: '¿Cuántos elementos retiene la memoria de trabajo?',
    back: 'Unos cuatro',
    cloze_text: null,
    context_cue: '[Memoria de trabajo]',
    concept_ids: ['c1'],
    importance: 'high',
    interference_group: null,
    as_of: null,
    citations: ['B01'],
    ...overrides,
  }
}

const NOW = new Date('2026-09-10T00:00:00.000Z')

function input(
  flashcards: readonly Flashcard[],
  existing = new Map<string, Float32Array | null>(),
) {
  return {
    lessonSpecId: 'L01',
    flashcards,
    context,
    primaryConceptId: 'c1',
    existing,
    importanceFloor: null,
    now: NOW,
  }
}

describe('toMemoryItems()', () => {
  it('creates the item in "Need to Learn" with a real due date', () => {
    const { drafts } = toMemoryItems(input([card()]))
    expect(drafts).toHaveLength(1)
    const draft = drafts[0]
    // §11 step 1: generated but not scheduled. `cards.due` is NOT NULL and mirrors ts-fsrs,
    // so what keeps this out of the queue is the item's status, not a null due.
    expect(draft?.item.status).toBe('need_to_learn')
    expect(draft?.item.createdBy).toBe('ai')
    expect(draft?.card.due).toEqual(NOW)
    expect(draft?.card.state).toBe(0)
    expect(draft?.card.reps).toBe(0)
  })

  it('carries the locator and the block ids of the fragment it cites', () => {
    const { drafts } = toMemoryItems(input([card()]))
    expect(drafts[0]?.item.sourceId).toBe('src-book')
    expect(drafts[0]?.item.locator).toEqual({
      label: 'p. 8',
      block_ids: ['b1', 'b2'],
      chunk_id: 'chunk-1',
    })
  })

  it('uses a cloze template and the sentence as the front', () => {
    const cloze = card({
      type: 'cloze',
      front: null,
      back: null,
      cloze_text: 'La memoria de trabajo retiene {{c1::cuatro}} elementos.',
    })
    const { drafts } = toMemoryItems(input([cloze]))
    expect(drafts[0]?.card.template).toBe('cloze:c1')
    expect(frontOf(cloze)).toContain('{{c1::cuatro}}')
  })

  it('drops a card the path already asks in the same words', () => {
    const existing = new Map<string, Float32Array | null>([[frontKey(card()), null]])
    const result = toMemoryItems(input([card()], existing))
    expect(result.drafts).toEqual([])
    expect(result.deduped).toBe(1)
    expect(result.warnings.map((entry) => entry.code)).toEqual(['flashcard_deduped'])
  })

  it('says when a card cites nothing that resolves, and keeps it anyway', () => {
    const { drafts, warnings } = toMemoryItems(input([card({ citations: ['B99'] })]))
    // Rule 18 wants a `source_id` and a locator on every card; this one can have neither, so
    // "Reportar error" has nowhere to open and 8.4's gates have nothing to check it against.
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.item.sourceId).toBeNull()
    expect(drafts[0]?.item.locator).toBeNull()
    expect(warnings.map((entry) => entry.code)).toContain('flashcard_uncited')
  })

  it('folds case and accents before comparing, so two spellings are one card', () => {
    const first = card({ front: 'La memoria de trabajo' })
    const second = card({ front: 'la MEMORIA de trabajo.' })
    const result = toMemoryItems(input([first, second]))
    expect(result.drafts).toHaveLength(1)
    expect(result.deduped).toBe(1)
  })
})

describe('effectiveImportance()', () => {
  it('takes the higher of the model’s proposal and the path’s floor', () => {
    expect(effectiveImportance('normal', 'urgent')).toBe('urgent')
    expect(effectiveImportance('high', null)).toBe('high')
    expect(effectiveImportance('urgent', 'maintenance')).toBe('urgent')
  })
})

describe('dedupeByEmbedding()', () => {
  it('keeps every card and says so when the provider cannot answer', async () => {
    // A wired provider with no model downloaded throws. Failing the lesson over it would mean
    // a fresh install cannot expand a path at all; the honest degradation is the exact pass
    // alone, which is what no provider at all already gives.
    const drafts = toMemoryItems(input([card()])).drafts
    const pass = await dedupeByEmbedding(
      drafts,
      new Map(),
      {
        embed: async () => {
          throw new Error('no embedding model is available')
        },
      },
      'L01',
    )

    expect(pass.kept).toEqual(drafts)
    expect(pass.deduped).toBe(0)
    expect(pass.warnings.map((entry) => entry.code)).toEqual(['embeddings_unavailable'])
  })

  const unit = (values: readonly number[]): Float32Array => {
    const norm = Math.hypot(...values)
    return Float32Array.from(values.map((value) => value / norm))
  }

  it('drops a card whose front means what one already on the path means', async () => {
    const { drafts } = toMemoryItems(input([card({ front: 'Otra formulación' })]))
    const existing = new Map<string, Float32Array | null>([['ya-existe', unit([1, 0])]])
    const result = await dedupeByEmbedding(
      drafts,
      existing,
      { embed: async () => [unit([0.99, 0.14])] },
      'L01',
    )
    expect(result.kept).toEqual([])
    expect(result.deduped).toBe(1)
    expect(result.warnings.map((entry) => entry.code)).toEqual(['flashcard_deduped'])
  })

  it('keeps a card that is merely on the same topic', async () => {
    const { drafts } = toMemoryItems(input([card({ front: 'Algo distinto' })]))
    const existing = new Map<string, Float32Array | null>([['ya-existe', unit([1, 0])]])
    const result = await dedupeByEmbedding(
      drafts,
      existing,
      { embed: async () => [unit([0.7, 0.7])] },
      'L01',
    )
    expect(result.kept).toHaveLength(1)
    expect(result.vectors.size).toBe(1)
  })

  it('compares the batch against itself too', async () => {
    const { drafts } = toMemoryItems(
      input([card({ front: 'Una' }), card({ front: 'Otra manera de decir Una' })]),
    )
    const result = await dedupeByEmbedding(
      drafts,
      new Map(),
      { embed: async () => [unit([1, 0]), unit([0.99, 0.14])] },
      'L01',
    )
    expect(result.kept).toHaveLength(1)
    expect(result.deduped).toBe(1)
  })
})
