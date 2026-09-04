import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'matching_pairs',
  generator: {
    promptTemplate: promptStub({
      type: 'matching_pairs',
      focus: 'Terms on the left matched to their definitions on the right.',
      rules: [
        'Four to six pairs, plus one or two `rightDistractors`.',
        '`presentation` is `drag`; the right column is shuffled by the host, not by the generator.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 4,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 45, progression: 'assisted' },
})
