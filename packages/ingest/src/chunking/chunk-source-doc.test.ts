import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeSourceDoc, paragraph } from '../../test/make-source-doc'
import { parseMarkdown } from '../parsers/markdown'
import { parsePdf } from '../parsers/pdf'
import type { SourceDoc } from '../source-doc'
import {
  CHUNKING_RULES_VERSION,
  chunkingVersion,
  chunkSourceDoc,
  needsRechunk,
} from './chunk-source-doc'
import { countTokensByChars } from './tokenizer'
import type { ChunkDraft, ChunkingResult } from './types'

const FIXTURES = join(import.meta.dirname, '..', '..', 'test', 'fixtures')

function parseContext() {
  let id = 0
  return {
    id: () => {
      id += 1
      return `id-${id}`
    },
    putAsset: async () => ({
      id: 'asset',
      blobSha256: '0'.repeat(64),
      mime: 'image/png',
      kind: 'image' as const,
    }),
  }
}

async function parseFixture(
  file: string,
  fallbackTitle: string,
  kind: 'pdf' | 'markdown',
): Promise<SourceDoc> {
  const bytes = new Uint8Array(await readFile(join(FIXTURES, file)))
  const input = { bytes, fallbackTitle }
  return kind === 'pdf'
    ? parsePdf(input, parseContext())
    : parseMarkdown(input, parseContext(), { frontmatter: true })
}

/** The `docs/spec` bounds, as a checkable statement about a whole result. */
function assertSpecBounds(result: ChunkingResult, doc: SourceDoc): void {
  const atomicBlocks = new Set(
    doc.blocks
      .filter((block) => ['table', 'code', 'equation', 'figure'].includes(block.type))
      .map((block) => block.id),
  )

  // 1. Every block belongs to at least one chunk.
  const covered = new Set(result.chunks.flatMap((chunk) => chunk.blockIds))
  const missed = doc.blocks.filter(
    (block) => block.text.trim().length > 0 && !covered.has(block.id),
  )
  expect(missed.map((block) => block.id)).toEqual([])

  // 2. No chunk is over the ceiling, unless it is a single atomic block that already was.
  for (const chunk of result.chunks) {
    if (chunk.tokenCount <= 1_200) continue
    expect(chunk.blockIds).toHaveLength(1)
    expect(atomicBlocks.has(chunk.blockIds[0] as string)).toBe(true)
  }

  // 3. No chunk is under the floor unless it is the last one of its section. A transcript
  //    window has no section (it is bounded by time, not by structure) and is exempt by
  //    construction — `sectionId` is `null` for exactly those.
  const bySection = new Map<string, ChunkDraft[]>()
  for (const chunk of result.chunks) {
    if (chunk.sectionId === null) continue
    const list = bySection.get(chunk.sectionId) ?? []
    list.push(chunk)
    bySection.set(chunk.sectionId, list)
  }
  for (const [sectionId, chunks] of bySection) {
    for (const chunk of chunks.slice(0, -1)) {
      expect(
        chunk.tokenCount,
        `chunk ${chunk.ordinal} of section ${sectionId} is under the 150-token floor`,
      ).toBeGreaterThanOrEqual(150)
    }
  }

  // 4. Offsets address the text they claim to.
  for (const chunk of result.chunks) {
    expect(result.normalizedText.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text)
    expect(chunk.tokenCount).toBe(countTokensByChars(chunk.text))
  }
}

describe('chunkSourceDoc', () => {
  it('makes one chunk of a section that already fits, with its heading path and block ids', () => {
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        {
          title: 'Cap. 3',
          children: [{ title: '3.2', blocks: [{ text: paragraph(300) }] }],
        },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.headingPath).toBe('Libro > Cap. 3 > 3.2')
    expect(chunks[0]?.blockIds).toEqual([doc.blocks[0]?.id])
    expect(chunks[0]?.locator.block_ids).toEqual([doc.blocks[0]?.id])
    expect(chunks[0]?.isFrontmatter).toBe(false)
  })

  it('splits a section over the ceiling into 300–500-token chunks that overlap', () => {
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        {
          title: 'Cap. 1',
          blocks: Array.from({ length: 20 }, (_, index) => ({
            text: paragraph(120, `p${index}`),
          })),
        },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // §4's band: 300–500 tokens. The last chunk is the tail of the section and may be
      // short — everything before it has to land inside it.
      expect(chunk.tokenCount).toBeLessThanOrEqual(500)
      expect(chunk.headingPath).toBe('Libro > Cap. 1')
    }
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokenCount).toBeGreaterThanOrEqual(300)
    }
    // 10–15 % overlap: consecutive chunks share at least one block.
    for (const [index, chunk] of chunks.slice(1).entries()) {
      const previous = chunks[index] as ChunkDraft
      const shared = chunk.blockIds.filter((id) => previous.blockIds.includes(id))
      expect(shared.length).toBeGreaterThan(0)
    }
    assertSpecBounds(chunkSourceDoc(doc, { sourceId: 'src' }), doc)
  })

  it('closes at the last boundary inside the band, not the first one past the target', () => {
    // 300-token paragraphs: closing at "the first boundary past 400" would pair them into
    // 600-token chunks, which is outside the 300–500 band the spec asks for.
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        {
          title: 'Cap. 1',
          blocks: Array.from({ length: 6 }, (_, index) => ({ text: paragraph(300, `q${index}`) })),
        },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(chunks.map((chunk) => chunk.tokenCount).every((tokens) => tokens <= 500)).toBe(true)
    expect(chunks.length).toBeGreaterThanOrEqual(6)
  })

  it('merges a section under the floor into the one after it', () => {
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        { title: 'Intro', blocks: [{ text: paragraph(40) }] },
        { title: 'Cap. 1', blocks: [{ text: paragraph(300) }] },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(chunks).toHaveLength(1)
    // The merged chunk keeps the heading path it *starts* under.
    expect(chunks[0]?.headingPath).toBe('Libro > Intro')
    expect(chunks[0]?.blockIds).toHaveLength(2)
  })

  it('does not merge a small section across the front-matter boundary', () => {
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        { title: 'Bibliografía', blocks: [{ text: paragraph(40, 'cita') }] },
        { title: 'Capítulo 1', blocks: [{ text: paragraph(300, 'texto') }] },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    // Merging would have hidden a bibliography inside a chapter — the merge rule stops at the
    // flag, and the bibliography stays its own (small, and last of its section) chunk.
    expect(chunks).toHaveLength(2)
    expect(chunks.map((chunk) => chunk.isFrontmatter)).toEqual([true, false])
  })

  it('never splits a table, even one bigger than the ceiling', () => {
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [
        {
          title: 'Datos',
          blocks: [
            { text: paragraph(200) },
            { type: 'table', text: paragraph(1_500, 'celda') },
            { text: paragraph(200) },
          ],
        },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    const tableId = doc.blocks[1]?.id as string
    const withTable = chunks.filter((chunk) => chunk.blockIds.includes(tableId))
    expect(withTable).toHaveLength(1)
    expect(withTable[0]?.blockIds).toEqual([tableId])
    expect(withTable[0]?.tokenCount).toBeGreaterThan(1_200)
    assertSpecBounds(chunkSourceDoc(doc, { sourceId: 'src' }), doc)
  })

  it('splits a single oversized paragraph on sentence boundaries', () => {
    const sentences = Array.from(
      { length: 12 },
      (_, index) => `${paragraph(150, `frase${index}`)}.`,
    ).join(' ')
    const doc = makeSourceDoc({
      title: 'Libro',
      sections: [{ title: 'Muro', blocks: [{ text: sentences }] }],
    })

    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(result.chunks.length).toBeGreaterThan(1)
    for (const chunk of result.chunks) expect(chunk.tokenCount).toBeLessThanOrEqual(1_200)
    // Every piece still names the block it came out of, so the citation survives the split.
    for (const chunk of result.chunks) expect(chunk.blockIds).toEqual([doc.blocks[0]?.id])
    assertSpecBounds(result, doc)
  })

  it('chunks a web page by H2/H3, folding deeper headings into their section', () => {
    const doc = makeSourceDoc({
      title: 'Página',
      kind: 'web',
      sections: [
        {
          title: 'H1',
          blocks: [{ text: paragraph(200) }],
          children: [
            {
              title: 'H2',
              blocks: [{ text: paragraph(200) }],
              children: [
                {
                  title: 'H3',
                  blocks: [{ text: paragraph(200) }],
                  children: [{ title: 'H4', blocks: [{ text: paragraph(200) }] }],
                },
              ],
            },
          ],
        },
      ],
    })

    const { chunks } = chunkSourceDoc(doc, { sourceId: 'src' })

    // H4 does not open a chunk: its content belongs to the H3 that contains it.
    expect(chunks.map((chunk) => chunk.headingPath)).toEqual([
      'Página > H1',
      'Página > H1 > H2',
      'Página > H1 > H2 > H3',
    ])
    const h3 = chunks[2] as ChunkDraft
    expect(h3.blockIds).toHaveLength(2)
  })

  it('is deterministic: the same document twice gives byte-identical chunk keys', async () => {
    const doc = await parseFixture('pdf/five-pages.pdf', 'Cinco páginas', 'pdf')
    const first = chunkSourceDoc(doc, { sourceId: 'src-1' })
    const second = chunkSourceDoc(doc, { sourceId: 'src-1' })
    expect(second.chunks).toEqual(first.chunks)
  })

  it('keys chunks per source: the same text under another source id is another chunk', async () => {
    const doc = await parseFixture('pdf/five-pages.pdf', 'Cinco páginas', 'pdf')
    const first = chunkSourceDoc(doc, { sourceId: 'src-1' })
    const other = chunkSourceDoc(doc, { sourceId: 'src-2' })
    expect(other.chunks.map((chunk) => chunk.key)).not.toEqual(
      first.chunks.map((chunk) => chunk.key),
    )
    // …but the content hash, which is what dedupe and the embedding cache key on, is the same.
    expect(other.chunks.map((chunk) => chunk.hash)).toEqual(first.chunks.map((chunk) => chunk.hash))
  })

  it('anchors each chunk to the page it opens on (PDF)', async () => {
    const doc = await parseFixture('pdf/five-pages.pdf', 'Cinco páginas', 'pdf')
    const result = chunkSourceDoc(doc, { sourceId: 'src-1' })

    expect(result.units.map((unit) => unit.key)).toEqual([
      'page:1',
      'page:2',
      'page:3',
      'page:4',
      'page:5',
    ])
    for (const chunk of result.chunks) {
      expect(chunk.unitKey).toMatch(/^page:\d+$/)
      expect(chunk.locator.page).toBe(Number(chunk.unitKey?.slice('page:'.length)))
      expect(chunk.locator.label).toBe(`p. ${chunk.locator.page}`)
    }
    assertSpecBounds(result, doc)
  })

  it('golden: the Markdown fixture', async () => {
    const doc = await parseFixture('markdown/sample.md', 'Sample', 'markdown')
    const result = chunkSourceDoc(doc, { sourceId: 'src-md' })

    assertSpecBounds(result, doc)
    expect(
      result.chunks.map((chunk) => ({
        ordinal: chunk.ordinal,
        headingPath: chunk.headingPath,
        tokenCount: chunk.tokenCount,
        blocks: chunk.blockIds.length,
        isFrontmatter: chunk.isFrontmatter,
        text: chunk.text,
      })),
    ).toMatchSnapshot()
  })

  it('golden: the book fixture, front matter flagged', async () => {
    const doc = await parseFixture('pdf/book-with-frontmatter.pdf', 'Libro', 'pdf')
    const result = chunkSourceDoc(doc, { sourceId: 'src-book' })

    assertSpecBounds(result, doc)
    expect(
      result.chunks.map((chunk) => ({
        ordinal: chunk.ordinal,
        page: chunk.locator.page,
        headingPath: chunk.headingPath,
        isFrontmatter: chunk.isFrontmatter,
        opens: chunk.text.slice(0, 48),
      })),
    ).toMatchSnapshot()
  })

  it('reports the version it chunked under, and what makes a chunk stale', () => {
    const doc = makeSourceDoc({ sections: [{ title: 'A', blocks: [{ text: paragraph(200) }] }] })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })

    expect(result.chunkingVersion).toBe(`${CHUNKING_RULES_VERSION}:chars4`)
    expect(needsRechunk(result.chunkingVersion, result.chunkingVersion)).toBe(false)
    expect(needsRechunk(null, result.chunkingVersion)).toBe(true)
    expect(needsRechunk('1:cl100k', result.chunkingVersion)).toBe(true)
    expect(chunkingVersion({ id: 'cl100k', count: countTokensByChars })).toBe(
      `${CHUNKING_RULES_VERSION}:cl100k`,
    )
  })

  it('returns nothing for a document with no text', () => {
    const doc = makeSourceDoc({ sections: [{ title: 'Vacío', blocks: [{ text: '   ' }] }] })
    const result = chunkSourceDoc(doc, { sourceId: 'src' })
    expect(result.chunks).toEqual([])
    expect(result.units).toEqual([])
  })
})
