import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'dialog_cards',
  generator: {
    promptTemplate: promptStub({
      type: 'dialog_cards',
      focus:
        'A prompt on the front and its explanation on the back; the learner says whether they knew it.',
      rules: [
        'Exactly one card; the front may be a cue rather than a question.',
        'Use it for material with no single exact answer, where a self-check is honest.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 12,
    sourceMode: 'skill',
  },
  review: { expectedSeconds: 12, progression: 'recognition' },
})
