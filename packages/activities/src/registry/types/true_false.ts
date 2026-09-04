import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'true_false',
  generator: {
    promptTemplate: promptStub({
      type: 'true_false',
      focus: 'A single claim the learner judges true or false.',
      rules: [
        'Exactly two options — the claim holding and not holding — with one `correct: true`.',
        'The claim is falsifiable from the source alone, never a matter of opinion.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 10,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 12, progression: 'recognition' },
})
