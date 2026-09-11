import type { ActivityDraft } from '@retenia/activity-schema'
import { toActivityDraft } from '@retenia/activity-schema'
import { sampleChoice, sampleTextInput } from '@retenia/activity-schema/testing'
import { describe, expect, it } from 'vitest'
import { type NbmeContext, nbmeIssues } from './nbme'

/**
 * `nbme.ts` — the NBME item-writing rules against P9 fixtures
 * (`docs/spec/04-path-generation.md` §1.4, §4, §9).
 */

interface Option {
  readonly id: string
  readonly text: string
  readonly correct: boolean
  readonly feedback?: string
}

function mcq(prompt: string, options: readonly Option[]): ActivityDraft {
  const base = toActivityDraft(sampleChoice())
  return {
    ...base,
    type: 'mcq_single',
    prompt,
    payload: {
      family: 'choice',
      sets: [{ id: 's1', multiple: false, options: options.map((o) => ({ ...o })) }],
    },
  } as ActivityDraft
}

function tf(prompt: string): ActivityDraft {
  const base = toActivityDraft(sampleChoice())
  return {
    ...base,
    type: 'true_false',
    prompt,
    payload: {
      family: 'choice',
      sets: [
        {
          id: 's1',
          multiple: false,
          options: [
            { id: 'a', text: 'Verdadero', correct: true },
            { id: 'b', text: 'Falso', correct: false },
          ],
        },
      ],
    },
  } as ActivityDraft
}

const noMisconceptions: NbmeContext = { misconceptionsAvailable: false, misconceptionByOption: {} }
const codesOf = (draft: ActivityDraft, context: NbmeContext = noMisconceptions): string[] =>
  nbmeIssues(draft, context).map((issue) => issue.code)

/** A homogeneous, one-best-answer set with no NBME tells — the baseline every mutation starts from. */
const VALID_ES_OPTIONS: Option[] = [
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
]

const VALID_EN_OPTIONS: Option[] = [
  {
    id: 'a',
    text: 'Dopamine, released in the mesolimbic pathway',
    correct: true,
    feedback: 'Correct: dopamine drives the mesolimbic reward pathway.',
  },
  {
    id: 'b',
    text: 'Serotonin, released in the raphe nuclei',
    correct: false,
    feedback: 'Serotonin modulates mood, not reward prediction.',
  },
  {
    id: 'c',
    text: 'Acetylcholine, released at neuromuscular junctions',
    correct: false,
    feedback: 'That is the peripheral, not the reward, system.',
  },
  {
    id: 'd',
    text: 'Norepinephrine, released from the locus coeruleus',
    correct: false,
    feedback: 'That drives arousal, not reward.',
  },
]

describe('nbmeIssues() — one-best-answer rules', () => {
  it('a homogeneous Spanish mcq_single with per-option feedback and distractors mapped to misconceptions passes clean', () => {
    const draft = mcq(
      '¿Qué función cumple principalmente el hipocampo en la memoria?',
      VALID_ES_OPTIONS,
    )
    const context: NbmeContext = {
      misconceptionsAvailable: true,
      misconceptionByOption: { b: 'X001', c: 'X002', d: 'X003' },
    }
    expect(codesOf(draft, context)).toEqual([])
  })

  it('a homogeneous English mcq_single with per-option feedback and distractors mapped to misconceptions passes clean', () => {
    const draft = mcq(
      'Which neurotransmitter is most associated with reward and motivation?',
      VALID_EN_OPTIONS,
    )
    const context: NbmeContext = {
      misconceptionsAvailable: true,
      misconceptionByOption: { b: 'X001', c: 'X002', d: 'X003' },
    }
    expect(codesOf(draft, context)).toEqual([])
  })

  it('nbme_single_best_answer: two keyed options', () => {
    const options = VALID_ES_OPTIONS.map((o) => (o.id === 'b' ? { ...o, correct: true } : o))
    const draft = mcq('¿Qué función cumple principalmente el hipocampo en la memoria?', options)
    expect(codesOf(draft)).toEqual(['nbme_single_best_answer'])
  })

  it.each([
    ['es "Ambas son correctas"', 'es', 'Ambas son correctas'],
    ['es "A y B"', 'es', 'A y B'],
    ['en "Both of these"', 'en', 'Both of these'],
    ['en "All of the above"', 'en', 'All of the above'],
  ])('nbme_all_none_of_the_above: %s', (_label, lang, text) => {
    const base = lang === 'es' ? VALID_ES_OPTIONS : VALID_EN_OPTIONS
    const options = base.map((o) => (o.id === 'b' ? { ...o, text } : o))
    const prompt =
      lang === 'es'
        ? '¿Qué función cumple principalmente el hipocampo en la memoria?'
        : 'Which neurotransmitter is most associated with reward and motivation?'
    const draft = mcq(prompt, options)
    expect(codesOf(draft)).toContain('nbme_all_none_of_the_above')
  })

  it.each([
    ['es "Todas las anteriores"', 'es', 'Todas las anteriores'],
    ['es "Ninguna de las anteriores"', 'es', 'Ninguna de las anteriores'],
    ['en "None of the above"', 'en', 'None of the above'],
  ])(
    '%s also fires nbme_all_none_of_the_above (it happens to contain an absolute term too)',
    (_label, lang, text) => {
      const base = lang === 'es' ? VALID_ES_OPTIONS : VALID_EN_OPTIONS
      const options = base.map((o) => (o.id === 'b' ? { ...o, text } : o))
      const prompt =
        lang === 'es'
          ? '¿Qué función cumple principalmente el hipocampo en la memoria?'
          : 'Which neurotransmitter is most associated with reward and motivation?'
      const draft = mcq(prompt, options)
      expect(codesOf(draft)).toContain('nbme_all_none_of_the_above')
    },
  )

  it.each([
    ['es "siempre"', 'es', 'Esto siempre ocurre en el hipocampo'],
    ['es "nunca"', 'es', 'Esto nunca ocurre en el hipocampo'],
    ['es "jamás" (accented)', 'es', 'Esto jamás ocurre en el hipocampo'],
    ['es "únicamente" (accented)', 'es', 'Esto únicamente ocurre en el hipocampo'],
    ['es "Siempre" (capitalised)', 'es', 'Siempre ocurre en el hipocampo'],
    ['en "always"', 'en', 'This always happens in the reward pathway'],
    ['en "never"', 'en', 'This never happens in the reward pathway'],
    ['en "only"', 'en', 'This only happens in the reward pathway'],
    ['en "Only" (capitalised)', 'en', 'Only the reward pathway does this'],
  ])('nbme_absolute_term: %s', (_label, lang, text) => {
    const base = lang === 'es' ? VALID_ES_OPTIONS : VALID_EN_OPTIONS
    const options = base.map((o) => (o.id === 'b' ? { ...o, text } : o))
    const prompt =
      lang === 'es'
        ? '¿Qué función cumple principalmente el hipocampo en la memoria?'
        : 'Which neurotransmitter is most associated with reward and motivation?'
    const draft = mcq(prompt, options)
    expect(codesOf(draft)).toEqual(['nbme_absolute_term'])
  })

  it.each([
    [
      'es "siempreviva" (contains but is not "siempre")',
      'es',
      'Esa es una planta siempreviva del jardín',
    ],
    [
      'en "whenever" (contains but is not "never")',
      'en',
      'This applies whenever conditions change',
    ],
    [
      'en "knowledge" (contains no absolute term at all)',
      'en',
      'That tests background knowledge, not memorization',
    ],
  ])(
    'a word merely containing an absolute term does not trigger nbme_absolute_term: %s',
    (_l, lang, text) => {
      const base = lang === 'es' ? VALID_ES_OPTIONS : VALID_EN_OPTIONS
      const options = base.map((o) => (o.id === 'b' ? { ...o, text } : o))
      const prompt =
        lang === 'es'
          ? '¿Qué función cumple principalmente el hipocampo en la memoria?'
          : 'Which neurotransmitter is most associated with reward and motivation?'
      const draft = mcq(prompt, options)
      expect(codesOf(draft)).not.toContain('nbme_absolute_term')
    },
  )

  it('nbme_heterogeneous_options: one option is a paragraph beside the others’ phrases', () => {
    const options: Option[] = [
      { id: 'a', text: 'Consolidar recuerdos', correct: true, feedback: 'Correcto.' },
      { id: 'b', text: 'Controlar movimientos', correct: false, feedback: 'No.' },
      { id: 'c', text: 'Regular el ritmo', correct: false, feedback: 'No.' },
      {
        id: 'd',
        text:
          'Procesar información sensorial de muy diverso origen incluyendo estímulos visuales, ' +
          'auditivos y somatosensoriales integrados a lo largo de varias etapas corticales',
        correct: false,
        feedback: 'No.',
      },
    ]
    const draft = mcq('¿Qué función cumple principalmente el hipocampo en la memoria?', options)
    expect(codesOf(draft)).toEqual(['nbme_heterogeneous_options'])
  })

  it('nbme_longest_is_answer: the keyed option is markedly longer than every distractor', () => {
    const options: Option[] = [
      {
        id: 'a',
        text: 'Interneurona inhibitoria gabaérgica cortical',
        correct: true,
        feedback: 'Correcto.',
      },
      { id: 'b', text: 'Neurona motora', correct: false, feedback: 'No.' },
      { id: 'c', text: 'Célula glial', correct: false, feedback: 'No.' },
      { id: 'd', text: 'Axón mielinizado', correct: false, feedback: 'No.' },
    ]
    const draft = mcq('¿Qué tipo de célula es esta?', options)
    expect(codesOf(draft)).toEqual(['nbme_longest_is_answer'])
  })

  it('nbme_stem_not_question: the stem does not end in a question mark', () => {
    const draft = mcq(
      'El hipocampo cumple una función central en la memoria declarativa.',
      VALID_ES_OPTIONS,
    )
    expect(codesOf(draft)).toEqual(['nbme_stem_not_question'])
  })

  it('nbme_vague_lead_in: "¿Cuál de las siguientes afirmaciones es correcta?" cannot be answered from the options', () => {
    const draft = mcq('¿Cuál de las siguientes afirmaciones es correcta?', VALID_ES_OPTIONS)
    expect(codesOf(draft)).toEqual(['nbme_vague_lead_in'])
  })

  it('nbme_vague_lead_in: "Which of the following is true?" (English)', () => {
    const draft = mcq('Which of the following is true?', VALID_EN_OPTIONS)
    expect(codesOf(draft)).toEqual(['nbme_vague_lead_in'])
  })

  it('nbme_vague_lead_in: "Señalá la opción correcta" also fires (and, having no "?", stem_not_question too)', () => {
    const draft = mcq('Señalá la opción correcta', VALID_ES_OPTIONS)
    expect(codesOf(draft)).toContain('nbme_vague_lead_in')
  })

  it('nbme_distractor_without_misconception: a bare distractor, only when misconceptions were available', () => {
    const draft = mcq(
      '¿Qué función cumple principalmente el hipocampo en la memoria?',
      VALID_ES_OPTIONS,
    )
    const available: NbmeContext = {
      misconceptionsAvailable: true,
      misconceptionByOption: { b: 'X001', c: 'X002' }, // d is left bare
    }
    expect(codesOf(draft, available)).toEqual(['nbme_distractor_without_misconception'])

    const unavailable: NbmeContext = {
      misconceptionsAvailable: false,
      misconceptionByOption: { b: 'X001', c: 'X002' },
    }
    expect(codesOf(draft, unavailable)).toEqual([])
  })
})

describe('nbmeIssues() — true_false: only the absolute-term rule applies', () => {
  it('flags a statement using an absolute term', () => {
    const draft = tf('El hipocampo siempre consolida la memoria declarativa.')
    expect(codesOf(draft)).toEqual(['nbme_absolute_term'])
  })

  it('does not flag a statement without a question mark (true_false is a statement, not a question)', () => {
    const draft = tf('El hipocampo consolida la memoria declarativa a largo plazo.')
    expect(codesOf(draft)).toEqual([])
  })
})

describe('nbmeIssues() — non-choice families', () => {
  it('returns no issues for a family the NBME rules do not apply to', () => {
    const draft = toActivityDraft(sampleTextInput())
    expect(nbmeIssues(draft, noMisconceptions)).toEqual([])
  })
})
