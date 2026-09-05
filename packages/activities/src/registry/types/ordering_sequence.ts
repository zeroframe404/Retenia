import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'ordering_sequence',
  generator: {
    promptTemplate: promptStub({
      type: 'ordering_sequence',
      focus: 'The steps of a process, or events in time, put back in order.',
      rules: [
        "Four to eight items whose correct order is the source's own.",
        '`scoring` is `adjacent-pairs`, so a near-miss keeps most of the credit.',
        'Add `alternativeOrders` when two steps are genuinely interchangeable.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 4,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 40, progression: 'assisted' },
})
