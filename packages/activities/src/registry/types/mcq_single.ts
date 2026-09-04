import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'mcq_single',
  generator: {
    promptTemplate: promptStub({
      type: 'mcq_single',
      focus:
        'A single question about one concept, with one correct option and plausible distractors.',
      rules: [
        'Exactly one set, `multiple: false`, with four options and exactly one `correct: true`.',
        'Distractors are plausible and mutually exclusive; never "all of the above" or "none of the above".',
        'Options are of similar length, so length is not a tell.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 8,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 20, progression: 'recognition' },
})
