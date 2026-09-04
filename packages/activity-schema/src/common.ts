import { UUID_V7_PATTERN } from '@retenia/core'
import { z } from 'zod'

/**
 * The scalar and reference shapes every activity family shares
 * (`docs/spec/03-activities.md` §7, `ActivityBase`).
 *
 * Constraints expressed with `.min()`/`.regex()` are enforced by zod at parse time; the JSON
 * Schema exported for the LLM (`./json-schema`) demotes them to descriptions, because Claude's
 * strict mode accepts neither (`docs/spec/04-path-generation.md` §8).
 */

/** Markdown with `$TeX$`, fenced code and `[[media:ID]]` references (§7). */
export const richTextSchema = z
  .string()
  .min(1)
  .describe('Markdown; may contain $TeX$, fenced code and [[media:ID]] references.')
export type RichText = z.infer<typeof richTextSchema>

/** Option, gap, item, pair… ids: short, ASCII, unique within one activity. Not UUIDs. */
export const SHORT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const shortIdSchema = z
  .string()
  .regex(SHORT_ID_PATTERN)
  .describe('Short id (letters, digits, _ or -), unique within the whole activity.')
export type ShortId = z.infer<typeof shortIdSchema>

/** A conservative BCP-47 shape: `es-AR`, `en`, `pt-BR`, `zh-Hant-TW`. */
export const BCP47_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
export const langSchema = z
  .string()
  .regex(BCP47_PATTERN)
  .describe('BCP-47 language tag, lower-case primary subtag: es-AR, en, pt-BR.')

/** `docs/spec/00-conventions.md`: ids are UUIDv7 (the spec's `ULID` comment is superseded). */
export const activityIdSchema = z.string().regex(UUID_V7_PATTERN).describe('UUIDv7, lower-case.')

export const MEDIA_KINDS = ['image', 'audio', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_GENERATORS = ['tts', 'image', 'user-upload'] as const
export type MediaGenerator = (typeof MEDIA_GENERATORS)[number]

/**
 * A media asset the activity refers to by `[[media:ID]]` or by id in a payload field. Either
 * `src` (already available) or `generate` (a media job produces it — `pending_media` until then)
 * is required; that rule is `media-unresolvable` in `./validate`, kept out of the zod shape so the
 * exported JSON Schema stays plain.
 */
export const mediaRefSchema = z.object({
  id: shortIdSchema,
  kind: z.enum(MEDIA_KINDS),
  src: z.string().min(1).optional().describe('Blob sha256, media:// URL or file path.'),
  alt: z.string().min(1).optional(),
  generate: z
    .object({
      by: z.enum(MEDIA_GENERATORS),
      prompt: z.string().min(1).optional().describe('Text to synthesize or image prompt.'),
      voice: z.string().min(1).optional().describe('TTS voice id.'),
    })
    .optional(),
})
export type MediaRef = z.infer<typeof mediaRefSchema>

export const sourceSpanSchema = z.object({
  start: z.int().min(0),
  end: z.int().min(0),
})

/** `{docId, span, quote}` (§7): where in the sources the activity's claim comes from. */
export const sourceRefSchema = z.object({
  docId: z.string().min(1),
  span: z
    .union([sourceSpanSchema, z.string().min(1)])
    .optional()
    .describe('Character offsets in the chunk, or a locator label such as "p. 112".'),
  quote: z.string().min(1).optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

/** The `[[media:ID]]` token inside rich text. */
export const MEDIA_TOKEN_PATTERN = /\[\[media:([A-Za-z0-9_-]{1,64})\]\]/g
