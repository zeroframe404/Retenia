import { familyOf, MVP_TYPES, toActivityDraft } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { authorableTypes, createActivityAuthor, MAKE_ACTIVITIES_STAGE } from './author'
import { MAKE_ACTIVITIES_SCHEMA_ID } from './schema'

const prompt = {
  template: 'Write the exercises.\n\n{{task}}',
  promptVersion: '1',
  schemaVersion: MAKE_ACTIVITIES_SCHEMA_ID,
  role: 'smart' as const,
  temperature: 0.7,
}

const request = {
  lessonSpecId: 'L07',
  parentCustomId: 'P3_write_lesson-abc',
  lang: 'es-AR',
  title: 'La memoria de trabajo',
  objectives: [{ text: 'Aplicar el límite de cuatro', bloom: 'apply' as const }],
  concepts: [{ id: 'c1', name: 'Memoria de trabajo', definition: 'Retén breve.' }],
  blocks: [{ type: 'explanation', content: 'La capacidad es limitada.' }],
  misconceptions: [
    { id: 'X001', conceptId: 'c1', text: 'Retiene siete', whyWrong: 'El número es cuatro.' },
  ],
  families: ['choice' as const, 'cloze' as const],
  wanted: 8,
  overGeneration: 2,
  alreadyGenerated: [],
  variant: 0,
}

type Choiceish = { payload: { sets: { options: { feedback?: string }[] }[] } }

/** §4 requires per-option feedback of an AI-authored MCQ; the shared fixture has none. */
function withOptionFeedback<T>(draft: T): T {
  const copy = structuredClone(draft) as T & Choiceish
  for (const set of copy.payload.sets) {
    for (const [index, option] of set.options.entries()) {
      option.feedback = `Por qué la opción ${index + 1} es así.`
    }
  }
  return copy
}

describe('createActivityAuthor()', () => {
  it('refuses a prompt file pointed at another schema version', () => {
    expect(() =>
      createActivityAuthor({ prompt: { ...prompt, schemaVersion: 'make_activities@2' } }),
    ).toThrow(/parses "make_activities@1"/)
  })

  it('plans one call per family, with the type enum narrowed to it', () => {
    const calls = createActivityAuthor({ prompt }).plan(request)
    expect(calls.map((call) => call.family)).toEqual(['choice', 'cloze'])
    for (const call of calls) {
      expect(call.types).toEqual(authorableTypes(call.family))
      for (const type of call.types) expect(familyOf(type as never)).toBe(call.family)
      expect(call.customId.startsWith(MAKE_ACTIVITIES_STAGE)).toBe(true)
      // The sync and batch transports must be the same bytes, or one pays for the other's
      // answer twice (`extract/request.ts` establishes the rule).
      expect(call.batch.customId).toBe(call.customId)
      expect(call.batch.request.prompt).toBe(call.structured.prompt)
    }
  })

  it('asks for the over-generated count, and names the misconceptions to build from', () => {
    const [call] = createActivityAuthor({ prompt }).plan(request)
    expect(call?.structured.prompt).toContain('16 candidates')
    expect(call?.structured.prompt).toContain('X001')
    expect(call?.structured.prompt).toContain('wanted: 8')
  })

  it('gives "Más ejemplos" its own key, so it adds rather than replaces', () => {
    const author = createActivityAuthor({ prompt })
    const first = author.plan(request)[0]?.customId
    const second = author.plan({ ...request, variant: 1 })[0]?.customId
    expect(second).not.toBe(first)
  })

  it('collects a valid candidate into a row and an option', () => {
    const author = createActivityAuthor({ prompt })
    const [call] = author.plan(request)
    const draft = withOptionFeedback(toActivityDraft(sampleChoice()))
    const collected = author.collect(call as never, {
      candidates: [{ activity: draft, bloom: 'apply', misconception_ids: ['X001'] }],
      notes: [],
    })
    expect(collected.rejected).toEqual([])
    expect(collected.activities).toHaveLength(1)
    const authored = collected.activities[0]
    expect(authored?.row.type).toBe(draft.type)
    expect(authored?.row.misconceptionIds).toEqual(['X001'])
    expect(authored?.row.bloom).toBe('apply')
    // The pool-local key is what `composeLessonPractice` selects over and what carries the
    // choice back to the row; no UUIDv7 is minted here, because the repositories mint ids.
    expect(authored?.option.activityId).toBe(authored?.key)
    expect(authored?.key.startsWith(call?.customId as string)).toBe(true)
  })

  it('drops a candidate the per-type rules refuse, and says which rule', () => {
    const author = createActivityAuthor({ prompt })
    const [call] = author.plan(request)
    const draft = toActivityDraft(sampleChoice())
    const twoKeys = structuredClone(withOptionFeedback(draft)) as typeof draft & {
      payload: { sets: { options: { correct: boolean }[] }[] }
    }
    for (const option of twoKeys.payload.sets[0]?.options ?? []) option.correct = true
    const collected = author.collect(call as never, {
      candidates: [{ activity: twoKeys, bloom: 'apply', misconception_ids: [] }],
      notes: ['nothing else fits'],
    })
    expect(collected.activities).toEqual([])
    expect(collected.rejected[0]?.code).toBe('choice-single-correct-count')
    expect(collected.notes).toEqual(['nothing else fits'])
  })

  it('generates only types that have a renderer', () => {
    for (const family of ['choice', 'cloze', 'text_input', 'long_text'] as const) {
      for (const type of authorableTypes(family)) {
        expect(MVP_TYPES).toContain(type)
      }
    }
  })
})

describe('the MCQ rules the shipped envelope cannot carry (§4)', () => {
  it('rejects an MCQ whose options carry no feedback', () => {
    const author = createActivityAuthor({ prompt })
    const [call] = author.plan(request)
    const collected = author.collect(call as never, {
      candidates: [
        { activity: toActivityDraft(sampleChoice()), bloom: 'apply', misconception_ids: ['X001'] },
      ],
      notes: [],
    })

    expect(collected.activities).toEqual([])
    expect(collected.rejected[0]?.code).toBe('mcq_option_feedback_missing')
  })

  it('rejects an MCQ that names no misconception when the lesson listed some', () => {
    const author = createActivityAuthor({ prompt })
    const [call] = author.plan(request)
    const collected = author.collect(call as never, {
      candidates: [
        {
          activity: withOptionFeedback(toActivityDraft(sampleChoice())),
          bloom: 'apply',
          misconception_ids: [],
        },
      ],
      notes: [],
    })

    expect(collected.rejected[0]?.code).toBe('mcq_misconception_missing')
  })

  it('does not require a misconception of a lesson that listed none', () => {
    const author = createActivityAuthor({ prompt })
    const [call] = author.plan({ ...request, misconceptions: [] })
    expect(call?.misconceptionsAvailable).toBe(false)
    const collected = author.collect(call as never, {
      candidates: [
        {
          activity: withOptionFeedback(toActivityDraft(sampleChoice())),
          bloom: 'apply',
          misconception_ids: [],
        },
      ],
      notes: [],
    })

    expect(collected.rejected).toEqual([])
    expect(collected.activities).toHaveLength(1)
  })
})
