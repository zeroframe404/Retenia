import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'free_recall',
  generator: {
    promptTemplate: promptStub({
      type: 'free_recall',
      focus:
        'The learner explains a concept in their own words; an AI rubric grades the key points.',
      rules: [
        'List three to six `keyPoints` with `aliases` for the phrasings that count as covered.',
        'Set `minWords` so a one-word answer cannot pass.',
        'Include a `modelAnswer`: the grader shows it whatever the score.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 3,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 120, progression: 'production' },
})
