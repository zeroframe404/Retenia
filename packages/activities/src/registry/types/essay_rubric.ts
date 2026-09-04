import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'essay_rubric',
  generator: {
    promptTemplate: promptStub({
      type: 'essay_rubric',
      focus: 'A short written answer graded against an anchored rubric.',
      rules: [
        'Two to four `rubric` criteria, each with anchored levels (0 / 0.5 / 1) and a weight.',
        'Include a `modelAnswer` that would score full marks on every criterion.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 2,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 300, progression: 'production' },
})
