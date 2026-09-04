import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'complete_the_chat',
  generator: {
    promptTemplate: promptStub({
      type: 'complete_the_chat',
      focus: 'A short dialogue whose last turn is missing, with four candidate replies.',
      rules: [
        'Two or three turns of context, then four replies of which exactly one fits.',
        'The wrong replies are grammatical and on topic; only the meaning is off.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 25, progression: 'recognition' },
})
