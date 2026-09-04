import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'flashcard_basic',
  generator: {
    promptTemplate: promptStub({
      type: 'flashcard_basic',
      focus:
        'One term or question on the front, its answer on the back; the learner grades themselves.',
      rules: [
        'Exactly one card. The front asks something answerable in one breath.',
        'The back holds the answer and nothing else — context goes in `explanation`.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 12,
    sourceMode: 'skill',
  },
  review: { expectedSeconds: 10, progression: 'production' },
})
