import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'statement_set',
  generator: {
    promptTemplate: promptStub({
      type: 'statement_set',
      focus: 'One stem with four independent statements, each true or false (Kprime).',
      rules: [
        'One set per statement, each `multiple: false` with a true and a false option.',
        'The four statements are independent: knowing one must not give away another.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 4,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 45, progression: 'recognition' },
})
