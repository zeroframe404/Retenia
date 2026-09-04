import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'cloze_dropdown',
  generator: {
    promptTemplate: promptStub({
      type: 'cloze_dropdown',
      focus: 'A passage with gaps the learner fills from a per-gap dropdown.',
      rules: [
        'Every gap carries three or four `options`, one of which is an accepted answer.',
        'Distractors come from the same category as the answer.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 20, progression: 'recognition' },
})
