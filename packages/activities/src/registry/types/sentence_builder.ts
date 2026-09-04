import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'sentence_builder',
  generator: {
    promptTemplate: promptStub({
      type: 'sentence_builder',
      focus: 'A sentence rebuilt from shuffled tokens, with distractor tokens mixed in.',
      rules: [
        'Tokens are words or short chunks, never single letters.',
        '`scoring` is `exact`; add `alternativeOrders` for every other grammatical ordering.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 30, progression: 'assisted' },
})
