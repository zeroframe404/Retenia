import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'cloze_typed',
  generator: {
    promptTemplate: promptStub({
      type: 'cloze_typed',
      focus: 'A passage from the source with one to three gaps the learner types from memory.',
      rules: [
        'Each gap hides a load-bearing term, never an article or a connective.',
        'List the accepted spellings in `answers`; set `grading.fuzzy` for the rest.',
        'Never leave two gaps adjacent — the sentence has to stay readable.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 6,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 25, progression: 'production' },
})
