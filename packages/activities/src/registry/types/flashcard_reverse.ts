import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'flashcard_reverse',
  generator: {
    promptTemplate: promptStub({
      type: 'flashcard_reverse',
      focus: 'The same pair asked from the back: the answer is shown and the term recalled.',
      rules: [
        'Exactly one card, written so that the reverse direction is genuinely answerable.',
        'Skip the type when the back maps to several fronts.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 12,
    sourceMode: 'skill',
  },
  review: { expectedSeconds: 10, progression: 'production' },
})
