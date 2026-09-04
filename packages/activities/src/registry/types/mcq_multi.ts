import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'mcq_multi',
  generator: {
    promptTemplate: promptStub({
      type: 'mcq_multi',
      focus: 'A question whose answer is a subset of the options (multiple response).',
      rules: [
        'Exactly one set, `multiple: true`, with five options and two or three marked correct.',
        'Set `grading.partialCredit` so a partly right selection still scores.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 30, progression: 'recognition' },
})
