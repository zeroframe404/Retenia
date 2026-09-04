import type { Activity } from '../envelope'
import type { Grading, Review } from '../grading'

/**
 * Minimal valid activities, one per MVP family, for tests in this package and in the graders.
 * Pure (no fixtures on disk); the fixtures under `fixtures/` are the exhaustive set.
 */

export const SAMPLE_ID = '0192f000-0000-7000-8000-000000000001'

export function envelope(overrides: Partial<Activity> = {}) {
  return {
    id: SAMPLE_ID,
    schemaVersion: 1 as const,
    lang: 'es-AR',
    prompt: '¿Cuál es la capital de Francia?',
    skills: ['capital-francia'],
    difficulty: 1 as const,
    grading: { method: 'det' } satisfies Grading as Grading,
    review: { eligible: true, ratingStrategy: 'binary' } satisfies Review as Review,
    ...overrides,
  }
}

export function sampleChoice(): Activity<'choice'> {
  return {
    ...envelope(),
    family: 'choice',
    type: 'mcq_single',
    payload: {
      family: 'choice',
      sets: [
        {
          id: 's1',
          multiple: false,
          options: [
            { id: 'a', text: 'París', correct: true },
            { id: 'b', text: 'Lyon', correct: false },
            { id: 'c', text: 'Marsella', correct: false },
          ],
        },
      ],
    },
  }
}

export function sampleTextInput(): Activity<'text_input'> {
  return {
    ...envelope({
      prompt: 'Nombre de la capital de Francia.',
      grading: { method: 'fuzzy' },
      review: { eligible: true, ratingStrategy: 'fuzzy' },
    }),
    family: 'text_input',
    type: 'short_answer',
    payload: { family: 'text_input', inputKind: 'text', answers: [{ value: 'París' }] },
  }
}

export function sampleCloze(): Activity<'cloze'> {
  return {
    ...envelope({
      prompt: 'Completá la oración.',
      grading: { method: 'fuzzy' },
      review: { eligible: true, ratingStrategy: 'fuzzy' },
    }),
    family: 'cloze',
    type: 'cloze_typed',
    payload: {
      family: 'cloze',
      mode: 'typed',
      segments: [
        { kind: 'text', text: 'La capital de Francia es ' },
        { kind: 'gap', id: 'g1', answers: ['París'] },
        { kind: 'text', text: '.' },
      ],
    },
  }
}

export function sampleLongText(): Activity<'long_text'> {
  return {
    ...envelope({
      prompt: 'Explicá con tus palabras qué es la fotosíntesis.',
      grading: { method: 'ai' },
      review: { eligible: true, ratingStrategy: 'ai' },
      skills: ['fotosintesis'],
    }),
    family: 'long_text',
    type: 'free_recall',
    payload: {
      family: 'long_text',
      keyPoints: [
        { id: 'k1', text: 'luz solar', aliases: ['energía lumínica'] },
        { id: 'k2', text: 'dióxido de carbono', aliases: ['CO2'] },
        { id: 'k3', text: 'glucosa' },
      ],
    },
  }
}

export function samplePairs(): Activity<'pairs'> {
  return {
    ...envelope({
      prompt: 'Uní cada país con su capital.',
      review: { eligible: true, ratingStrategy: 'matching' },
      skills: ['capitales'],
    }),
    family: 'pairs',
    type: 'matching_pairs',
    payload: {
      family: 'pairs',
      presentation: 'drag',
      pairs: [
        { id: 'p1', left: 'Francia', right: 'París' },
        { id: 'p2', left: 'Italia', right: 'Roma' },
        { id: 'p3', left: 'España', right: 'Madrid' },
      ],
      rightDistractors: [{ id: 'd1', text: 'Lisboa' }],
    },
  }
}

export function sampleOrdering(): Activity<'ordering'> {
  return {
    ...envelope({
      prompt: 'Ordená los pasos del método científico.',
      review: { eligible: true, ratingStrategy: 'ordering' },
      skills: ['metodo-cientifico'],
    }),
    family: 'ordering',
    type: 'ordering_sequence',
    payload: {
      family: 'ordering',
      items: [
        { id: 'i1', text: 'Observación' },
        { id: 'i2', text: 'Hipótesis' },
        { id: 'i3', text: 'Experimento' },
        { id: 'i4', text: 'Conclusión' },
      ],
      correctOrder: ['i1', 'i2', 'i3', 'i4'],
      scoring: 'adjacent-pairs',
    },
  }
}

export function sampleCategorize(): Activity<'categorize'> {
  return {
    ...envelope({
      prompt: 'Clasificá cada animal.',
      review: { eligible: true, ratingStrategy: 'partial' },
      skills: ['vertebrados'],
    }),
    family: 'categorize',
    type: 'categorize',
    payload: {
      family: 'categorize',
      categories: [
        { id: 'c1', label: 'Mamíferos' },
        { id: 'c2', label: 'Aves' },
      ],
      items: [
        { id: 'i1', text: 'Perro', categoryIds: ['c1'] },
        { id: 'i2', text: 'Gorrión', categoryIds: ['c2'] },
        { id: 'i3', text: 'Ballena', categoryIds: ['c1'] },
      ],
    },
  }
}

export function sampleTextMark(): Activity<'text_mark'> {
  return {
    ...envelope({
      prompt: 'Marcá los verbos.',
      review: { eligible: true, ratingStrategy: 'partial' },
      skills: ['verbos'],
    }),
    family: 'text_mark',
    type: 'mark_the_words',
    payload: {
      family: 'text_mark',
      tokens: [
        { id: 't1', text: 'El' },
        { id: 't2', text: 'perro' },
        { id: 't3', text: 'corre' },
        { id: 't4', text: 'y' },
        { id: 't5', text: 'ladra' },
      ],
      correctIds: ['t3', 't5'],
    },
  }
}

export function sampleCards(): Activity<'cards'> {
  return {
    ...envelope({
      prompt: 'Capital de Francia',
      grading: { method: 'self' },
      review: { eligible: true, ratingStrategy: 'self' },
    }),
    family: 'cards',
    type: 'flashcard_basic',
    payload: { family: 'cards', cards: [{ id: 'c1', front: 'Capital de Francia', back: 'París' }] },
  }
}

export function sampleDisclosure(): Activity<'disclosure'> {
  return {
    ...envelope({
      prompt: 'Las tres leyes de Newton',
      skills: [],
      grading: { method: 'none' },
      review: { eligible: false, ratingStrategy: 'none' },
    }),
    family: 'disclosure',
    type: 'disclosure_block',
    payload: {
      family: 'disclosure',
      presentation: 'accordion',
      items: [
        { id: 'n1', title: 'Primera ley', body: 'Inercia.' },
        { id: 'n2', title: 'Segunda ley', body: 'F = m·a' },
      ],
    },
  }
}

/** One sample per MVP family. */
export function sampleActivities(): Activity[] {
  return [
    sampleChoice(),
    sampleTextInput(),
    sampleCloze(),
    sampleLongText(),
    samplePairs(),
    sampleOrdering(),
    sampleCategorize(),
    sampleTextMark(),
    sampleCards(),
    sampleDisclosure(),
  ]
}
