import { wrapUserContent } from '@retenia/ai'
import type { Chunk, Source, SourceLocator } from '@retenia/core'
import { parseSourceLocator } from '@retenia/core'
import { headerLine, oneLine } from '../text'

/**
 * The task half of a P1 call: what `{{task}}` in `P1_extract_chunk` receives
 * (`docs/spec/04-path-generation.md` §3 stage 3, §12 on injection).
 *
 * Everything that came out of the learner's file — the source's title, the heading path, the
 * situating context and the fragment itself — travels inside a `<user_content>` block, each
 * labelled so the prompt can name it. Only the identifiers our own chunker minted (the chunk
 * key, the block ids, the locator) sit outside the envelope, because they are the one thing
 * the model is asked to copy rather than read. A suspected injection is reported on the task
 * and never acted on: the chunk still goes to the model, wrapped, exactly as `user-content.ts`
 * argues it should.
 */

export type ExtractSource = Pick<Source, 'id' | 'title' | 'kind' | 'language'>

/** What extraction reads off a `chunks` row. */
export type ExtractableChunk = Pick<
  Chunk,
  | 'id'
  | 'sourceId'
  | 'ordinal'
  | 'text'
  | 'hash'
  | 'headingPath'
  | 'context'
  | 'chunkKey'
  | 'unitId'
  | 'locator'
>

export interface ExtractTask {
  readonly prompt: string
  /** The block ids the chunk covers — the only ones a claim may cite. */
  readonly blockIds: readonly string[]
  readonly injectionSuspected: boolean
}

export const MAX_TITLE_CHARS = 120
export const MAX_LOCATOR_CHARS = 40
/** More block ids than this in one chunk is a chunker bug, not a citation opportunity. */
export const MAX_BLOCK_IDS_LISTED = 200
/**
 * What a block id may look like to be listed: the UUIDs the chunker mints and the readable
 * ids fixtures use, never whitespace or brackets. The `block_ids` line sits outside the
 * envelope, and the locator column can be written by importers of other apps' data.
 */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** `p. 112`, `12:30–13:45`, the parser's own label, or a dash. */
export function locatorLabel(locator: SourceLocator): string {
  if (locator.label !== null) return locator.label
  if (locator.page !== null) return `p. ${locator.page}`
  if (locator.tStartMs !== null) {
    const start = formatTimestamp(locator.tStartMs)
    return locator.tEndMs === null ? start : `${start}–${formatTimestamp(locator.tEndMs)}`
  }
  return '—'
}

export function buildExtractTask(chunk: ExtractableChunk, source: ExtractSource): ExtractTask {
  const locator = parseSourceLocator(chunk)
  const blockIds = [...new Set(locator.blockIds)]
    .filter((id) => BLOCK_ID_PATTERN.test(id))
    .slice(0, MAX_BLOCK_IDS_LISTED)
  const language = source.language === null ? '' : `, ${oneLine(source.language, 16)}`
  const context = chunk.context === null ? '' : chunk.context.trim()

  const blocks = [
    wrapUserContent(
      `${oneLine(source.title, MAX_TITLE_CHARS)} (${source.kind}${language})`,
      'source',
    ),
    wrapUserContent(chunk.headingPath ?? '(no heading)', 'heading_path'),
    ...(context === '' ? [] : [wrapUserContent(context, 'context')]),
    wrapUserContent(chunk.text, 'chunk'),
  ]

  const prompt = [
    `chunk_key: ${chunk.chunkKey ?? chunk.hash}`,
    `block_ids: ${blockIds.length === 0 ? '(none)' : blockIds.join(', ')}`,
    `locator: ${headerLine(locatorLabel(locator), MAX_LOCATOR_CHARS)}`,
    '',
    ...blocks.map((block) => block.text),
    '',
    'Extract this fragment. Cite `block_ids` only from the list above, and cite none when no',
    'listed block holds the claim.',
  ].join('\n')

  return {
    prompt,
    blockIds,
    injectionSuspected: blocks.some((block) => block.injectionSuspected),
  }
}
