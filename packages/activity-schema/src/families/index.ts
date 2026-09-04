import type { ActivityFamily } from '@retenia/core'
import type { z } from 'zod'
import { cardsPayloadSchema } from './cards'
import { categorizePayloadSchema } from './categorize'
import { choicePayloadSchema } from './choice'
import { clozePayloadSchema } from './cloze'
import { disclosurePayloadSchema } from './disclosure'
import { longTextPayloadSchema } from './long-text'
import { orderingPayloadSchema } from './ordering'
import { pairsPayloadSchema } from './pairs'
import { placeholderPayloadSchema } from './placeholders'
import { textInputPayloadSchema } from './text-input'
import { textMarkPayloadSchema } from './text-mark'

export * from './cards'
export * from './categorize'
export * from './choice'
export * from './cloze'
export * from './disclosure'
export * from './long-text'
export * from './ordering'
export * from './pairs'
export * from './placeholders'
export * from './text-input'
export * from './text-mark'

/** One payload schema per family (`docs/spec/03-activities.md` §7): the 10 MVP families modelled, 13 placeholders. */
export const PAYLOAD_SCHEMAS = {
  choice: choicePayloadSchema,
  text_input: textInputPayloadSchema,
  cloze: clozePayloadSchema,
  long_text: longTextPayloadSchema,
  pairs: pairsPayloadSchema,
  ordering: orderingPayloadSchema,
  categorize: categorizePayloadSchema,
  image_target: placeholderPayloadSchema('image_target'),
  text_mark: textMarkPayloadSchema,
  scale: placeholderPayloadSchema('scale'),
  speech: placeholderPayloadSchema('speech'),
  dialogue: placeholderPayloadSchema('dialogue'),
  branching: placeholderPayloadSchema('branching'),
  media_checkpoints: placeholderPayloadSchema('media_checkpoints'),
  code: placeholderPayloadSchema('code'),
  math: placeholderPayloadSchema('math'),
  graph: placeholderPayloadSchema('graph'),
  grid_game: placeholderPayloadSchema('grid_game'),
  arcade: placeholderPayloadSchema('arcade'),
  cards: cardsPayloadSchema,
  disclosure: disclosurePayloadSchema,
  draw: placeholderPayloadSchema('draw'),
  simulation: placeholderPayloadSchema('simulation'),
} as const satisfies Record<ActivityFamily, z.ZodType>

export type Payload<F extends ActivityFamily = ActivityFamily> = z.infer<
  (typeof PAYLOAD_SCHEMAS)[F]
>
