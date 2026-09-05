import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'categorize',
  generator: {
    promptTemplate: promptStub({
      type: 'categorize',
      focus: 'Items sorted into the categories the source defines.',
      rules: [
        'Two to four categories and six to ten items, at least two per category.',
        'An item that honestly belongs in two categories lists both in `categoryIds`.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 4,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 40, progression: 'assisted' },
})
