import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'cloze_wordbank',
  generator: {
    promptTemplate: promptStub({
      type: 'cloze_wordbank',
      focus: 'A passage the learner completes by dragging words from a shared bank.',
      rules: [
        'Add one or two `bankDistractors` that fill no gap.',
        'Set `singleUseDraggables` when each word belongs in exactly one gap.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 30, progression: 'assisted' },
})
