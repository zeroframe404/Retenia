import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'numeric_answer',
  generator: {
    promptTemplate: promptStub({
      type: 'numeric_answer',
      focus:
        'A question answered with a number, with a tolerance and — when the quantity has one — a unit.',
      rules: [
        '`inputKind` is `number` and the `numeric` block carries the value, its tolerance and the unit.',
        'State the unit the answer is expected in inside the prompt.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 8,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 30, progression: 'production' },
})
