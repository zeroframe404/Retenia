import { timestampLabel } from '../chunking/transcript'
import { sha256Hex } from '../hash'
import type { WhisperSegment } from '../sidecars/whisper'
import type { Block } from '../source-doc'

/**
 * Turning what was said and what was on screen into the timed blocks 6.2 already knows how to
 * chunk (`docs/spec/05-ingestion-rag.md` §1: "merge of 'what it says + what it shows' into
 * 2–5 min chunks").
 *
 * The contract with sub-phase 6.2 is exactly one field wide: `chunkTranscript` treats a
 * document as a transcript when its kind is `audio`/`video`/`youtube` and *some block carries
 * a numeric `locator.timeSec`*, and then windows those blocks into 60–90 s units cut at the
 * longest pause. So this module's whole job is to emit blocks with correct global times and
 * get out of the way. Nothing here re-implements windowing — doing it twice would fight code
 * that is already written and tested.
 */

/** How long a slide has to be on screen before it is described a second time. The spec's
 *  "2–5 min"; the middle of that band, because it is a de-duplication granularity rather than
 *  a chunk size — the chunker still cuts at 60–90 s. */
export const FUSION_BUCKET_SECONDS = 150

/**
 * The most description text one frame contributes.
 *
 * 258 tokens is what a cloud vision model bills for a single image
 * (`docs/spec/05-ingestion-rag.md` §1: "258 tokens per image"), so capping the local OCR at
 * roughly the same size keeps a fused block the same weight whichever provider produced it —
 * a lesson prompt built from a Tesseract run and one built from Gemini Flash-Lite should not
 * differ in cost by an order of magnitude. Characters rather than tokens because this package
 * has a tokenizer for chunking, not for budgeting, and four characters per token is close
 * enough for a ceiling.
 */
export const MAX_FRAME_TEXT_CHARS = 258 * 4

/** A hook phase 8 fills with the path's own domain terms; identity until then. */
export type GlossaryCorrection = (text: string) => string

export const identityGlossary: GlossaryCorrection = (text) => text

export interface TranscriptBlockOptions {
  segments: readonly WhisperSegment[]
  /** Where this part starts on the source's global timeline. */
  offsetSec: number
  id: () => string
  glossary?: GlossaryCorrection
}

/**
 * One block per whisper segment, timestamped globally.
 *
 * Per segment rather than per window because the window is 6.2's to choose: it cuts at the
 * longest silence inside the 60–90 s band, and it can only find that silence if it can see
 * where each segment started and stopped. Handing it pre-merged minutes would throw away the
 * very signal it uses.
 */
export function transcriptBlocks(options: TranscriptBlockOptions): Block[] {
  const { segments, offsetSec, id, glossary = identityGlossary } = options
  const blocks: Block[] = []

  for (const segment of segments) {
    // The glossary runs before the hash, so a re-run with the same corrections is idempotent
    // and 6.2's dedupe sees a stable identity.
    const text = glossary(segment.text).trim()
    if (text.length === 0) continue
    blocks.push({
      id: id(),
      type: 'paragraph',
      text,
      locator: { timeSec: offsetSec + segment.startSec },
      hash: sha256Hex(text),
    })
  }

  return blocks
}

export interface ShownFrame {
  /** Global seconds. */
  timeSec: number
  /** OCR or vision description; empty when the frame carried no legible text. */
  text: string
}

export interface FusionOptions {
  frames: readonly ShownFrame[]
  id: () => string
  bucketSeconds?: number
  /** Prefixes the description so a chunk reads as prose rather than as a bare caption. The
   *  caller supplies it from i18n; a sensible English default keeps this module pure. */
  label?: (timeSec: number) => string
}

/**
 * One `figure` block per bucket that had something legible on screen.
 *
 * Emitting a *block* rather than post-processing the chunker's output is what makes this cost
 * nothing downstream: the block carries a `timeSec`, so `chunkTranscript` sorts it into place
 * and the 60–90 s window covering that moment ends up containing both the speech and the
 * slide. "Said + shown" is therefore an emergent property of the existing windowing rather
 * than a second code path through it.
 *
 * Bucketed so a slide that stays up for four minutes is described once, not once per frame:
 * the keyframe pass already deduped by picture, but a slow fade or a moving cursor can still
 * produce several frames of the same slide that differ by more than eight bits.
 */
export function fuseSaidAndShown(options: FusionOptions): Block[] {
  const {
    frames,
    id,
    bucketSeconds = FUSION_BUCKET_SECONDS,
    label = (timeSec) => `On screen (${timestampLabel(timeSec)}): `,
  } = options

  const legible = [...frames]
    .filter((frame) => frame.text.trim().length > 0)
    .sort((left, right) => left.timeSec - right.timeSec)

  const blocks: Block[] = []
  const seen = new Set<number>()

  for (const frame of legible) {
    const bucket = Math.floor(frame.timeSec / bucketSeconds)
    if (seen.has(bucket)) continue
    seen.add(bucket)

    const trimmed = frame.text.trim().slice(0, MAX_FRAME_TEXT_CHARS)
    const text = `${label(frame.timeSec)}${trimmed}`
    blocks.push({
      id: id(),
      type: 'figure',
      text,
      locator: { timeSec: frame.timeSec },
      hash: sha256Hex(text),
    })
  }

  return blocks
}

/** Blocks in the one order every consumer wants: the order they happen. */
export function byTime(blocks: readonly Block[]): Block[] {
  return [...blocks].sort(
    (left, right) => (left.locator.timeSec ?? 0) - (right.locator.timeSec ?? 0),
  )
}
