import type { ActivityDraft } from '@retenia/activity-schema'
import { toActivityDraft } from '@retenia/activity-schema'
import { sampleChoice } from '@retenia/activity-schema/testing'
import { loadPrompt } from '@retenia/ai/prompts'
import type { RemediationAuthorRequest } from '@retenia/core'
import { describe, expect, it } from 'vitest'
import type { RemediationAuthorCall } from './author'
import { createRemediationAuthor, RemediationAuthorError } from './author'
import { REMEDIATE_SCHEMA_ID } from './schema'

/**
 * P11's `plan`/`collect` (`docs/spec/04-path-generation.md` §9 P11): the request/response half
 * of remediation authoring, mirroring `make-items/author.test.ts`'s coverage but for one detour.
 */

const PROMPT = {
  template: '---\nrole: smart\n---\nWrite a remediation detour.',
  promptVersion: '1',
  schemaVersion: REMEDIATE_SCHEMA_ID,
  role: 'smart' as const,
  temperature: 0.5,
}

function request(overrides: Partial<RemediationAuthorRequest> = {}): RemediationAuthorRequest {
  return {
    pathVersionId: 'pv-1',
    specId: 'L07.r1',
    lang: 'es-AR',
    anchorTitle: 'Memoria de trabajo',
    concept: { id: 'c1', name: 'Bucle fonológico', definition: 'Subsistema verbal de la MCP.' },
    misconception: null,
    errors: [],
    excerpts: [],
    itemsWanted: 3,
    avoid: [],
    ...overrides,
  }
}

const MISCONCEPTION = {
  id: 'X001',
  conceptId: 'c1',
  text: 'La memoria de trabajo es ilimitada',
  whyWrong: 'Tiene una capacidad de 4±1 elementos.',
}

/**
 * Loosely typed, like `make-items/author.test.ts`'s `value`: `collect()` takes `unknown`, and a
 * candidate's `activity` is a full `ActivityDraft` (a wider union than the schema's narrowed
 * `choice`-family branch), which a `RemediateOutput`-typed literal would reject at compile time.
 */
function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Por qué la MCP no es ilimitada',
    blocks: [
      { type: 'explanation', content: 'Una explicación nueva.', citations: ['B01'] },
      { type: 'worked_example', content: 'Un ejemplo resuelto paso a paso.', citations: ['B01'] },
    ],
    items: [],
    contrast_card: null,
    notes: [],
    ...overrides,
  }
}

function callFixture(
  overrides: Partial<
    Pick<
      RemediationAuthorCall,
      'customId' | 'conceptIds' | 'misconceptionIds' | 'misconceptionsAvailable' | 'itemsWanted'
    >
  > = {},
) {
  return {
    customId: 'P11_remediation-abc123',
    conceptIds: ['c1'],
    misconceptionIds: ['X001', 'X002', 'X003'],
    misconceptionsAvailable: true,
    itemsWanted: 3,
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

describe('createRemediationAuthor()', () => {
  it('throws RemediationAuthorError when the schema version does not match remediate@1', () => {
    expect(() =>
      createRemediationAuthor({ prompt: { ...PROMPT, schemaVersion: 'remediate@2' } }),
    ).toThrow(RemediationAuthorError)
  })

  describe('the real prompt file', () => {
    it('declares schema remediate@1, role smart, and a {{task}} placeholder', () => {
      const loaded = loadPrompt('P11_remediation')
      expect(loaded.frontmatter.schema).toBe(REMEDIATE_SCHEMA_ID)
      expect(loaded.frontmatter.role).toBe('smart')
      expect(loaded.template).toContain('{{task}}')
      expect(() =>
        createRemediationAuthor({
          prompt: {
            template: loaded.template,
            promptVersion: loaded.promptVersion,
            schemaVersion: loaded.frontmatter.schema,
            role: loaded.frontmatter.role,
            temperature: loaded.frontmatter.temperature,
          },
        }),
      ).not.toThrow()
    })
  })

  describe('plan()', () => {
    it('builds a customId stable for the same (pathVersionId, specId, concept.id)', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const first = author.plan(request()).customId
      const second = author.plan(request()).customId
      expect(first).toBe(second)
    })

    it('a different pathVersionId changes the customId', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const a = author.plan(request()).customId
      const b = author.plan(request({ pathVersionId: 'pv-2' })).customId
      expect(a).not.toBe(b)
    })

    it('a different specId changes the customId', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const a = author.plan(request()).customId
      const b = author.plan(request({ specId: 'L07.r2' })).customId
      expect(a).not.toBe(b)
    })

    it('a different concept.id changes the customId', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const a = author.plan(request()).customId
      const b = author.plan(
        request({ concept: { id: 'c2', name: 'Otro concepto', definition: 'Otra definición.' } }),
      ).customId
      expect(a).not.toBe(b)
    })

    it('structured carries schemaName remediate and the prompt temperature', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request())
      expect(call.structured.schemaName).toBe('remediate')
      expect(call.structured.temperature).toBe(PROMPT.temperature)
      expect(call.structured.idempotencyKey).toBe(call.customId)
    })

    it('batch.customId is the same customId', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request())
      expect(call.batch.customId).toBe(call.customId)
    })

    it('conceptIds is [concept.id]', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request())
      expect(call.conceptIds).toEqual(['c1'])
    })

    it('misconceptionIds is [] and misconceptionsAvailable is false when misconception is null', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request({ misconception: null }))
      expect(call.misconceptionIds).toEqual([])
      expect(call.misconceptionsAvailable).toBe(false)
    })

    it('misconceptionIds is [id] and misconceptionsAvailable is true when a misconception is given', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request({ misconception: MISCONCEPTION }))
      expect(call.misconceptionIds).toEqual(['X001'])
      expect(call.misconceptionsAvailable).toBe(true)
    })

    it('itemsWanted floors a fractional value', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request({ itemsWanted: 2.7 }))
      expect(call.itemsWanted).toBe(2)
    })

    it('itemsWanted never goes below 0', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = author.plan(request({ itemsWanted: -1 }))
      expect(call.itemsWanted).toBe(0)
    })
  })

  describe('collect()', () => {
    it('returns no blocks/items and one "schema" rejection for a schema-invalid value', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(callFixture(), { not: 'a remediate output' })
      expect(collected.blocks).toEqual([])
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual([
        expect.objectContaining({ type: 'remediation', code: 'schema' }),
      ])
    })

    it('keeps one explanation and one worked_example, with no worked_example rejection', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(callFixture(), output())
      expect(collected.blocks).toEqual([
        { type: 'explanation', content: 'Una explicación nueva.', citations: ['B01'] },
        { type: 'worked_example', content: 'Un ejemplo resuelto paso a paso.', citations: ['B01'] },
      ])
      expect(collected.rejected.some((r) => r.code.startsWith('worked_example'))).toBe(false)
    })

    it('drops a second worked_example with code worked_example_extra', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(
        callFixture(),
        output({
          blocks: [
            { type: 'explanation', content: 'Explicación.', citations: [] },
            { type: 'worked_example', content: 'Primer ejemplo.', citations: [] },
            { type: 'worked_example', content: 'Segundo ejemplo.', citations: [] },
          ],
        }),
      )
      expect(collected.blocks).toHaveLength(2)
      expect(collected.blocks.some((b) => b.content === 'Segundo ejemplo.')).toBe(false)
      expect(collected.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'remediation', code: 'worked_example_extra' }),
        ]),
      )
    })

    it('rejects worked_example_missing when there is none', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(
        callFixture(),
        output({ blocks: [{ type: 'explanation', content: 'Solo explicación.', citations: [] }] }),
      )
      expect(collected.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'remediation', code: 'worked_example_missing' }),
        ]),
      )
    })

    it('keeps a valid mcq_single item as an AuthoredItem with status ready, conceptIds and stem', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = callFixture({ itemsWanted: 3 })
      const collected = author.collect(call, output({ items: [candidate()] }))
      expect(collected.items).toHaveLength(1)
      const item = collected.items[0]
      if (item === undefined) throw new Error('expected one item')
      expect(item.row.status).toBe('ready')
      expect(item.conceptIds).toEqual(['c1'])
      expect(item.stem).toBe('¿Qué función cumple principalmente el hipocampo en la memoria?')
      expect(collected.rejected).toEqual([])
    })

    it('rejects an item naming a concept the call did not give as item_concept_unknown', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = callFixture({ conceptIds: ['c1'] })
      const outside = candidate({ activity: draft({ skills: ['other-concept'] }) })
      const collected = author.collect(call, output({ items: [outside] }))
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'item_concept_unknown' })]),
      )
    })

    it('rejects an invalid item, e.g. two correct options', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const twoCorrect = draft()
      if (twoCorrect.payload.family === 'choice') {
        const set = twoCorrect.payload.sets[0]
        if (set !== undefined) {
          set.options = set.options.map((o) => (o.id === 'b' ? { ...o, correct: true } : o))
        }
      }
      const call = callFixture()
      const collected = author.collect(
        call,
        output({ items: [candidate({ activity: twoCorrect })] }),
      )
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'mcq_single', code: 'choice-single-correct-count' }),
        ]),
      )
    })

    it('truncates more valid items than itemsWanted, with an items_extra rejection', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = callFixture({ itemsWanted: 2 })
      const items = [
        candidate({ activity: draft({ prompt: '¿Cuál es la primera función del hipocampo?' }) }),
        candidate({ activity: draft({ prompt: '¿Cuál es la segunda función del hipocampo?' }) }),
        candidate({ activity: draft({ prompt: '¿Cuál es la tercera función del hipocampo?' }) }),
      ]
      const collected = author.collect(call, output({ items }))
      expect(collected.items).toHaveLength(2)
      expect(collected.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'remediation', code: 'items_extra' }),
        ]),
      )
    })

    it('itemsWanted 0 drops every item, with an items_extra rejection', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const call = callFixture({ itemsWanted: 0 })
      const collected = author.collect(call, output({ items: [candidate()] }))
      expect(collected.items).toEqual([])
      expect(collected.rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'remediation', code: 'items_extra' }),
        ]),
      )
    })

    it('maps contrast_card to {front, back, citations}', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(
        callFixture(),
        output({
          contrast_card: {
            front: '¿En qué se diferencia la MCP de la MLP?',
            back: 'La MCP es limitada y breve; la MLP es prácticamente ilimitada.',
            citations: ['B01'],
          },
        }),
      )
      expect(collected.contrastCard).toEqual({
        front: '¿En qué se diferencia la MCP de la MLP?',
        back: 'La MCP es limitada y breve; la MLP es prácticamente ilimitada.',
        citations: ['B01'],
      })
    })

    it('contrastCard stays null when contrast_card is null', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(callFixture(), output({ contrast_card: null }))
      expect(collected.contrastCard).toBeNull()
    })

    it('passes title and notes through', () => {
      const author = createRemediationAuthor({ prompt: PROMPT })
      const collected = author.collect(
        callFixture(),
        output({ title: 'Un título', notes: ['no hay ejemplo suficiente'] }),
      )
      expect(collected.title).toBe('Un título')
      expect(collected.notes).toEqual(['no hay ejemplo suficiente'])
    })
  })
})
