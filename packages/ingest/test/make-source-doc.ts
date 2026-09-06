import { sha256Hex } from '../src/hash'
import type { Block, BlockType, Locator, Section, SourceDoc } from '../src/source-doc'

/**
 * A small builder for the synthetic `SourceDoc`s the chunking tests need.
 *
 * The parser fixtures (`test/fixtures/`) cover what real documents look like; these cover the
 * *shapes* — a section of exactly 1,201 tokens, a table in the middle of a long chapter, a
 * transcript with a pause at 73 s — that no real fixture happens to contain and that every
 * rule in `src/chunking/` is about.
 */

export interface BlockSpec {
  type?: BlockType
  text: string
  locator?: Locator
}

export interface SectionSpec {
  title: string
  level?: number
  blocks?: BlockSpec[]
  children?: SectionSpec[]
}

export interface DocSpec {
  title?: string
  kind?: SourceDoc['kind']
  language?: string | null
  /** Blocks before the first heading, as a parser's preamble section would hold them. */
  preamble?: BlockSpec[]
  sections?: SectionSpec[]
  /** For transcripts: blocks with `locator.timeSec`, in one flat list. */
  segments?: Array<{ text: string; atSec: number }>
}

/**
 * A paragraph of *exactly* `tokens` tokens under the `chars4` heuristic (`ceil(chars / 4)`).
 *
 * Built to a character budget rather than a word count on purpose: the tests set up sections
 * that sit one token either side of the 1,200 ceiling and the 150 floor, and a helper whose
 * size depended on how long `stem` happened to be would make those setups silently wrong.
 * `stem` only varies the words so two paragraphs are distinguishable in a failure message.
 */
export function paragraph(tokens: number, stem = 'palabra'): string {
  const chars = Math.max(1, tokens) * 4
  let text = ''
  for (let index = 0; text.length < chars; index += 1) {
    text += `${text.length === 0 ? '' : ' '}${stem}${index}`
  }
  return text.slice(0, chars)
}

export function makeSourceDoc(spec: DocSpec): SourceDoc {
  const blocks: Block[] = []
  let nextId = 0
  const id = (prefix: string): string => {
    nextId += 1
    return `${prefix}-${nextId}`
  }

  const addBlock = (block: BlockSpec): string => {
    const entry: Block = {
      id: id('b'),
      type: block.type ?? 'paragraph',
      text: block.text,
      locator: block.locator ?? {},
      hash: sha256Hex(block.text),
    }
    blocks.push(entry)
    return entry.id
  }

  const buildSection = (section: SectionSpec, level: number): Section => ({
    id: id('s'),
    title: section.title,
    level: section.level ?? level,
    blocks: (section.blocks ?? []).map(addBlock),
    children: (section.children ?? []).map((child) => buildSection(child, level + 1)),
  })

  const sections: Section[] = []

  if (spec.preamble !== undefined && spec.preamble.length > 0) {
    sections.push({
      id: id('s'),
      title: spec.title ?? 'Documento',
      level: 0,
      blocks: spec.preamble.map(addBlock),
      children: [],
    })
  }

  for (const section of spec.sections ?? []) sections.push(buildSection(section, 1))

  if (spec.segments !== undefined) {
    const segmentIds = spec.segments.map((segment) =>
      addBlock({ text: segment.text, locator: { timeSec: segment.atSec } }),
    )
    sections.push({
      id: id('s'),
      title: spec.title ?? 'Grabación',
      level: 0,
      blocks: segmentIds,
      children: [],
    })
  }

  return {
    id: 'doc-1',
    kind: spec.kind ?? 'markdown',
    title: spec.title ?? 'Documento',
    language: spec.language ?? 'es',
    sections,
    blocks,
    assets: [],
    meta: { warnings: [] },
  }
}
