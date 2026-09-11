import type { ActivityDraft } from '@retenia/activity-schema'
import { toActivityDraft } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing'
import type { ItemAuthorCell, ItemAuthorRequest } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import { createItemAuthor, type ItemAuthorCall, ItemAuthorError } from './author'
import { MAKE_ITEMS_SCHEMA_ID } from './schema'

/**
 * P9's `plan`/`collect` (`docs/spec/04-path-generation.md` §9): the request/response half of
 * item authoring, mirroring `make-activities/author.ts`'s coverage but for the item bank.
 */

const PROMPT = {
  template: '---\nrole: smart\n---\nWrite exam-grade items.',
  promptVersion: '1',
  schemaVersion: MAKE_ITEMS_SCHEMA_ID,
  role: 'smart' as const,
  temperature: 0.3,
}

function cell(overrides: Partial<ItemAuthorCell> = {}): ItemAuthorCell {
  return {
    key: 'M03|exam|apply|hard',
    kind: 'exam',
    bloom: 'apply',
    difficulties: [3, 4],
    forms: ['A', 'B'],
    ...overrides,
  }
}

function request(overrides: Partial<ItemAuthorRequest> = {}): ItemAuthorRequest {
  return {
    blueprintKey: 'bp-hash-1',
    lang: 'es-AR',
    moduleTitle: 'Memoria de trabajo',
    objectives: [{ text: 'Explicar el bucle fonológico', bloom: 'understand' }],
    concepts: [{ id: 'c1', name: 'Bucle fonológico', definition: 'Subsistema verbal de la MCP.' }],
    misconceptions: [
      {
        id: 'X001',
        conceptId: 'c1',
        text: 'La memoria de trabajo es ilimitada',
        whyWrong: 'Tiene una capacidad de 4±1 elementos.',
      },
    ],
    excerpts: ['La memoria de trabajo retiene entre 4 y 7 elementos por un breve lapso.'],
    cell: cell(),
    overGeneration: 3,
    avoid: [],
    ...overrides,
  }
}

/** Four homogeneous, feedback-carrying options that clear every NBME rule. */
function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  const base = toActivityDraft(sampleChoice())
  return {
    ...base,
    type: 'mcq_single',
    skills: ['c1'],
    difficulty: 3,
    prompt: '¿Qué función cumple principalmente el hipocampo en la memoria?',
    payload: {
      family: 'choice',
      sets: [
        {
          id: 's1',
          multiple: false,
          options: [
            {
              id: 'a',
              text: 'Consolidar recuerdos declarativos a largo plazo',
              correct: true,
              feedback: 'Correcto: el hipocampo consolida la memoria declarativa.',
            },
            {
              id: 'b',
              text: 'Controlar los movimientos voluntarios finos',
              correct: false,
              feedback: 'Esa es una función del cerebelo, no del hipocampo.',
            },
            {
              id: 'c',
              text: 'Regular el ritmo cardíaco y la respiración',
              correct: false,
              feedback: 'Esa es una función del bulbo raquídeo.',
            },
            {
              id: 'd',
              text: 'Procesar la información visual periférica',
              correct: false,
              feedback: 'Esa es una función de la corteza occipital.',
            },
          ],
        },
      ],
    },
    ...overrides,
  } as ActivityDraft
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    activity: draft(),
    bloom: 'apply',
    misconception_ids: ['X001'],
    form: null,
    option_misconceptions: [
      { option_id: 'b', misconception_id: 'X001' },
      { option_id: 'c', misconception_id: 'X002' },
      { option_id: 'd', misconception_id: 'X003' },
    ],
    ...overrides,
  }
}

function callFixture(overrides: Partial<ItemAuthorCall> = {}) {
  return {
    customId: 'P9_items-abc123',
    misconceptionsAvailable: true,
    conceptIds: ['c1'],
    misconceptionIds: ['X001', 'X002', 'X003'],
    forms: [] as const,
    ...overrides,
  }
}

describe('createItemAuthor()', () => {
  it('throws ItemAuthorError when the schema version does not match make_items@1', () => {
    expect(() =>
      createItemAuthor({ prompt: { ...PROMPT, schemaVersion: 'make_items@2' } }),
    ).toThrow(ItemAuthorError)
  })

  describe('plan()', () => {
    it('builds a customId stable for the same (blueprintKey, cell.key, prompt/schema version)', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const first = author.plan(request()).customId
      const second = author.plan(request()).customId
      expect(first).toBe(second)
    })

    it('builds a different customId for a different cell', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const a = author.plan(request()).customId
      const b = author.plan(request({ cell: cell({ key: 'M03|exam|apply|easy' }) })).customId
      expect(a).not.toBe(b)
    })

    it('a different blueprintKey also changes the customId', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const a = author.plan(request()).customId
      const b = author.plan(request({ blueprintKey: 'bp-hash-2' })).customId
      expect(a).not.toBe(b)
    })

    it('structured and batch share the same idempotencyKey/customId', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = author.plan(request())
      expect(call.structured.idempotencyKey).toBe(call.customId)
      expect(call.batch.customId).toBe(call.customId)
    })

    it('carries forms, conceptIds and misconceptionIds from the request onto the call', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = author.plan(request())
      expect(call.forms).toEqual(['A', 'B'])
      expect(call.conceptIds).toEqual(['c1'])
      expect(call.misconceptionIds).toEqual(['X001'])
      expect(call.misconceptionsAvailable).toBe(true)
    })

    it('misconceptionsAvailable is false when the request lists none', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = author.plan(request({ misconceptions: [] }))
      expect(call.misconceptionsAvailable).toBe(false)
    })
  })

  describe('collect()', () => {
    it('returns one "schema" rejection for a schema-invalid value', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const collected = author.collect(callFixture(), { items: [], notes: [] })
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([
        expect.objectContaining({ type: 'choice', code: 'schema' }),
      ])
    })

    it('keeps a valid item and maps row, form, difficulty, conceptIds, misconceptionByOption and stem', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = callFixture({
        forms: [],
        conceptIds: ['c1'],
        misconceptionIds: ['X001', 'X002', 'X003'],
      })
      const collected = author.collect(call, { items: [candidate()], notes: ['a note'] })

      expect(collected.rejected).toEqual([])
      expect(collected.notes).toEqual(['a note'])
      expect(collected.items).toHaveLength(1)
      const item = collected.items[0]
      if (item === undefined) throw new Error('expected one item')

      expect(item.key).toBe(`${call.customId}#0`)
      expect(item.row.bloom).toBe('apply')
      expect(item.row.status).toBe('ready')
      expect(item.row.misconceptionIds).toEqual(['X001', 'X002', 'X003'])
      expect('lessonId' in item.row).toBe(false)
      expect('ordinal' in item.row).toBe(false)
      expect(item.form).toBeNull()
      expect(item.difficulty).toBe(3)
      expect(item.conceptIds).toEqual(['c1'])
      expect(item.misconceptionByOption).toEqual({ b: 'X001', c: 'X002', d: 'X003' })
      expect(item.stem).toBe('¿Qué función cumple principalmente el hipocampo en la memoria?')
    })

    it('drops an option_misconceptions pair whose option id does not exist on the item', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      // misconceptionsAvailable: false, so a bare distractor does not also trip the NBME rule —
      // this test is about the id-filtering logic, not about nbme_distractor_without_misconception.
      const call = callFixture({ misconceptionsAvailable: false })
      const value = {
        items: [
          candidate({
            option_misconceptions: [
              { option_id: 'b', misconception_id: 'X001' },
              { option_id: 'nope', misconception_id: 'X002' },
            ],
          }),
        ],
        notes: [],
      }
      const collected = author.collect(call, value)
      expect(collected.rejected).toEqual([])
      expect(collected.items[0]?.misconceptionByOption).toEqual({ b: 'X001' })
    })

    it('drops an option_misconceptions pair naming a misconception id the call did not allow', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = callFixture({ misconceptionsAvailable: false, misconceptionIds: ['X001'] }) // X002/X003 not allowed
      const value = { items: [candidate()], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.rejected).toEqual([])
      expect(collected.items[0]?.misconceptionByOption).toEqual({ b: 'X001' })
    })

    it('rejects a checkActivity failure, e.g. two correct options', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const twoCorrect = draft()
      if (twoCorrect.payload.family === 'choice') {
        const set = twoCorrect.payload.sets[0]
        if (set !== undefined) {
          set.options = set.options.map((o) => (o.id === 'b' ? { ...o, correct: true } : o))
        }
      }
      const call = callFixture()
      const value = { items: [candidate({ activity: twoCorrect })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([
        expect.objectContaining({ type: 'mcq_single', code: 'choice-single-correct-count' }),
      ])
    })

    it('rejects an mcqIssue failure, e.g. only 3 options', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const threeOptions = draft()
      if (threeOptions.payload.family === 'choice') {
        const set = threeOptions.payload.sets[0]
        if (set !== undefined) set.options = set.options.slice(0, 3)
      }
      const call = callFixture()
      const value = { items: [candidate({ activity: threeOptions })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([expect.objectContaining({ code: 'mcq_option_count' })])
    })

    it('rejects an NBME rule violation, e.g. the stem is not a question', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const statement = draft({ prompt: 'El hipocampo consolida la memoria declarativa.' })
      const call = callFixture()
      const value = { items: [candidate({ activity: statement })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([
        expect.objectContaining({ code: 'nbme_stem_not_question' }),
      ])
    })

    it('rejects a skill outside call.conceptIds as item_concept_unknown', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const outside = draft({ skills: ['unknown-concept'] })
      const call = callFixture({ conceptIds: ['c1'] })
      const value = { items: [candidate({ activity: outside })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([
        expect.objectContaining({ code: 'item_concept_unknown' }),
      ])
    })

    it('rejects an exam-cell item (forms A/B) whose form is null as item_form_missing', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = callFixture({ forms: ['A', 'B'] })
      const value = { items: [candidate({ form: null })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([expect.objectContaining({ code: 'item_form_missing' })])
    })

    it('a non-exam cell (no forms) coerces a stray form to null rather than rejecting', () => {
      const author = createItemAuthor({ prompt: PROMPT })
      const call = callFixture({ forms: [] })
      const value = { items: [candidate({ form: 'A' })], notes: [] }
      const collected = author.collect(call, value)
      expect(collected.rejected).toEqual([])
      expect(collected.items[0]?.form).toBeNull()
    })
  })
})
