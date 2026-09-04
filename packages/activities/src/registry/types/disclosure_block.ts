import { promptStub } from '../prompt-stub'
import { defineActivityType } from '../registry'

export default defineActivityType({
  type: 'disclosure_block',
  generator: {
    promptTemplate: promptStub({
      type: 'disclosure_block',
      focus:
        'A theory block the learner opens section by section: accordion, tabs, process or timeline.',
      rules: [
        'Three to six items, each with a title that stands alone in a table of contents.',
        'This type is lesson-only: it feeds no rating, so it carries no answer.',
      ],
    }),
    needsMedia: false,
    itemsPerCall: 3,
    sourceMode: 'section',
  },
  review: { expectedSeconds: 60, progression: 'theory' },
})
