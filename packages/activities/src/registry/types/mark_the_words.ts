import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'mark_the_words',
  generator: {
    promptTemplate: promptStub({
      type: 'mark_the_words',
      focus: 'The learner highlights the words in a passage that match the instruction.',
      rules: [
        'Tokenize the passage as the learner sees it: punctuation stays attached to its word.',
        'Between 10 % and 40 % of the tokens are correct — never almost all of them.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 4,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 35, progression: 'recognition' },
})
