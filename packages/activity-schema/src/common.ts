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

/**
 * Length ceilings on the free-text fields.
 *
 * Every string below is written by a model (§11's generation pipeline) or comes from an imported
 * deck, and every one of them is rendered by `@retenia/activities`' `RichText`, which calls
 * KaTeX's `renderToString` once per `$…$` span synchronously on the renderer thread. Unbounded,
 * a single field of a few megabytes of `$x$` pairs is a study screen that never paints — so the
 * bound is part of the schema, not of the renderer.
 *
 * The numbers are far above any real content and far below that: the largest string across the
 * 107 fixtures in `fixtures/` is 118 characters (an option `text`), and the longest field the
 * families use for prose is a `disclosure` `body` or a `long_text` `modelAnswer` — a few
 * paragraphs. They are enforced by zod at parse time only; the JSON Schema handed to the LLM
 * demotes `maxLength` to a sentence in `description` (see the note above).
 */

/** One block of Markdown: ≈1 300 words, three printed pages, ~68× the largest fixture value. */
export const RICH_TEXT_MAX = 8_000
/** A long plain string that is not Markdown: a TTS script (≈2 minutes of speech), a source quote. */
export const PLAIN_TEXT_MAX = 2_000
/** A one-line label or identifier: `alt` text, a voice id, a document id, a page locator. */
export const LABEL_MAX = 500

/**
 * The same ceiling, one level up: how many elements a collection may hold.
 *
 * Bounding every *element* leaves the *count* open, and the count is the cheaper of the two
 * attacks — 100 000 individually-legal hints, or one `text_mark` token per word of a book, is
 * still a screen that never paints. `min()` already says what a family needs; this says what no
 * family may exceed.
 *
 * One number rather than eight, because the purpose is "bounded", not "sized": the schema has no
 * opinion on how many options an MCQ should have, only that the answer is not "unlimited". The
 * largest array across the fixtures holds 10 entries (a `mark_the_words` `tokens`), so 500 is
 * 50× real content and still a screen that renders.
 */
export const COLLECTION_MAX = 500

/** Markdown with `$TeX$`, fenced code and `[[media:ID]]` references (§7). */
export const richTextSchema = z
  .string()
  .min(1)
  .max(RICH_TEXT_MAX)
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
 * The two forms a `MediaRef.src` may take:
 *
 * - `sha256:<hex>` — the content-addressed blob reference of `00-conventions.md` ("blobs live
 *   outside the DB, content-addressed by sha256"), which `@retenia/activities`'
 *   `defaultResolveMedia` turns into a `media://blob/<hash>` URL. Neither the hex length nor the
 *   case is pinned here, because that resolver pins neither (`SHA256_REF_PATTERN` is `/i`); the
 *   blob store is what decides a hash exists.
 * - `media://…` — the app's own protocol, served by `apps/desktop`'s `media-protocol.ts`, which
 *   validates the path itself before touching the disk.
 *
 * Nothing else: `src` is model-written or comes from an imported deck and is handed straight to
 * `<img src>`, `<video src>` and `new Audio(src)`, so `javascript:`, `data:`, `http(s)://`,
 * `file://` and bare filesystem paths are rejected at the schema. The renderer keeps the matching
 * runtime allow-list (`@retenia/activities`' `host/ports.ts`) — the two are independent on
 * purpose, since a `MediaRef` can reach a renderer from a source this schema never parsed.
 */
export const MEDIA_SRC_PATTERN = /^(?:sha256:[0-9a-f]+|media:\/\/[a-z0-9._~\-/%]+)$/i

/**
 * A media asset the activity refers to by `[[media:ID]]` or by id in a payload field. Either
 * `src` (already available) or `generate` (a media job produces it — `pending_media` until then)
 * is required; that rule is `media-unresolvable` in `./validate`, kept out of the zod shape so the
 * exported JSON Schema stays plain.
 */
export const mediaRefSchema = z.object({
  id: shortIdSchema,
  kind: z.enum(MEDIA_KINDS),
  src: z
    .string()
    .min(1)
    .max(LABEL_MAX)
    .regex(MEDIA_SRC_PATTERN)
    .optional()
    .describe('Blob reference `sha256:<hex>` or a `media://` URL. No other scheme is accepted.'),
  alt: z.string().min(1).max(LABEL_MAX).optional(),
  generate: z
    .object({
      by: z.enum(MEDIA_GENERATORS),
      prompt: z
        .string()
        .min(1)
        .max(PLAIN_TEXT_MAX)
        .optional()
        .describe('Text to synthesize or image prompt.'),
      voice: z.string().min(1).max(LABEL_MAX).optional().describe('TTS voice id.'),
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
  docId: z.string().min(1).max(LABEL_MAX),
  span: z
    .union([sourceSpanSchema, z.string().min(1).max(LABEL_MAX)])
    .optional()
    .describe('Character offsets in the chunk, or a locator label such as "p. 112".'),
  quote: z.string().min(1).max(PLAIN_TEXT_MAX).optional(),
})
export type SourceRef = z.infer<typeof sourceRefSchema>

/** The `[[media:ID]]` token inside rich text. */
export const MEDIA_TOKEN_PATTERN = /\[\[media:([A-Za-z0-9_-]{1,64})\]\]/g
