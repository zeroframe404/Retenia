import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'short_answer',
  generator: {
    promptTemplate: promptStub({
      type: 'short_answer',
      focus: 'A question answered in a word or a short phrase, typed from memory.',
      rules: [
        '`inputKind` is `text`; the first entry of `answers` is the canonical one.',
        'List synonyms and accepted spellings under `grading.fuzzy.synonyms`.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 8,
    sourceMode: 'chunk',
  },
  review: { expectedSeconds: 20, progression: 'production' },
})
