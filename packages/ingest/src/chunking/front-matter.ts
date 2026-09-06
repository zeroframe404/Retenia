import type { Block, Section, SourceDoc } from '../source-doc'

/**
 * Front and back matter detection (`docs/spec/04-path-generation.md` §14, pitfall 6:
 * "front/back matter that contaminates the outline").
 *
 * A table of contents is the worst input a path generator can get: it is a list of every
 * heading in the book, so the extractor of stage 3 reads it as a hundred shallow "concepts"
 * with no content behind them, and the outline of stage 4 then mirrors the book's index
 * instead of its argument. Copyright pages, dedications, bibliographies and alphabetical
 * indexes fail the same way with different noise.
 *
 * They are **flagged, not dropped**. A chunk of the bibliography is still worth retrieving
 * ("which edition of Dunlosky does this cite?") and is still citable; what stage 4 needs is
 * to be able to say `WHERE is_frontmatter = 0`, which is exactly what this produces.
 *
 * The signals are deliberately shallow — a section title, a page's own shape — because the
 * alternative is asking a model, and this runs before any provider is configured. Two
 * signals decide:
 *
 * 1. **The heading says so.** `Contents`, `Índice`, `Copyright`, `Bibliografía`… matched
 *    against a title, in Spanish and English.
 * 2. **The page looks like one.** A block whose lines mostly end in a page number (with or
 *    without dot leaders) is a table of contents even when the heading was lost to the PDF
 *    parser; a block carrying `©`/`ISBN`/`all rights reserved` is a copyright page.
 *
 * Position gates the *generic* titles only. "References" as the last section of a book is
 * back matter; "References" as §2.4 of chapter 2 is a lesson, and a lesson must not be
 * excluded from the path because of its name.
 */

/** Titles that are front/back matter wherever they appear — nobody writes a chapter called
 *  "Table of contents". */
const UNAMBIGUOUS_TITLES: readonly RegExp[] = [
  /^\s*(table\s+of\s+)?contents\s*$/i,
  /^\s*(í|i)ndice(\s+(general|de\s+contenidos?|anal(í|i)tico|alfab(é|e)tico|onom(á|a)stico|tem(á|a)tico))?\s*$/i,
  /^\s*tabla\s+de\s+contenidos?\s*$/i,
  /^\s*sumario\s*$/i,
  /^\s*copyright\s*$/i,
  /^\s*(cr(é|e)ditos|colof(ó|o)n)\s*$/i,
  /^\s*(p(á|a)gina\s+de\s+)?derechos\s+de\s+autor\s*$/i,
  /^\s*legal\s+notice\s*$/i,
  /^\s*(dedication|dedicatoria)\s*$/i,
  /^\s*(acknowledgge?ments|acknowledgements|acknowledgments|agradecimientos)\s*$/i,
  /^\s*(about\s+the\s+author|sobre\s+el\s+autor|acerca\s+del\s+autor)\s*$/i,
  /^\s*(list\s+of\s+(figures|tables)|(í|i)ndice\s+de\s+(figuras|tablas|ilustraciones))\s*$/i,
]

/** Titles that are back matter at the end of a book and a perfectly good lesson in the
 *  middle of one. */
const POSITIONAL_TITLES: readonly RegExp[] = [
  /^\s*(bibliography|bibliograf(í|i)a)\s*$/i,
  /^\s*(references|referencias)(\s+(bibliogr(á|a)ficas|cited))?\s*$/i,
  /^\s*(works|obras)\s+(cited|citadas)\s*$/i,
  /^\s*(index|(í|i)ndice\s+de\s+materias)\s*$/i,
  /^\s*(further\s+reading|lecturas?\s+recomendadas?)\s*$/i,
  /^\s*(preface|prefacio|pr(ó|o)logo|foreword|introducci(ó|o)n\s+del\s+(autor|editor))\s*$/i,
]

/** A generic title counts only inside the first or last slice of the document. */
const FRONT_FRACTION = 0.12
const BACK_FRACTION = 0.12

/** …with a floor, so a 20-page article still gets a couple of pages of leeway at each end. */
const MIN_EDGE_BLOCKS = 6

/** A line ending in a page number, with dot leaders (`Cap. 3 …… 47`), spaced dots, or just
 *  whitespace (`Cap. 3    47`). */
const TOC_LINE = /(?:[.·…\-\s]{2,}|\s)\d{1,4}\s*$/

/** Below this a "list of lines ending in numbers" is just a short numbered list. */
const MIN_TOC_LINES = 4
/** …and this much of the block has to look that way. */
const TOC_LINE_RATIO = 0.6

const COPYRIGHT_MARKERS =
  /(©|\(c\)\s*\d{4}|\bISBN\b|all\s+rights\s+reserved|todos\s+los\s+derechos\s+reservados|dep(ó|o)sito\s+legal)/i

/** A table of contents that lost its heading: most of its lines end in a page number. */
export function looksLikeTocBlock(text: string): boolean {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length < MIN_TOC_LINES) return false
  const hits = lines.filter((line) => TOC_LINE.test(line)).length
  return hits / lines.length >= TOC_LINE_RATIO
}

/** A copyright page: the markers only ever appear on one. */
export function looksLikeCopyrightBlock(text: string): boolean {
  return COPYRIGHT_MARKERS.test(text)
}

export interface FrontMatterOptions {
  /** Override the edge fractions; mostly for tests. */
  frontFraction?: number
  backFraction?: number
}

export interface FrontMatterFlags {
  /** Sections whose own blocks (and every descendant's) are front/back matter. */
  sectionIds: ReadonlySet<string>
  /** Individual blocks flagged on their own shape, plus every block under a flagged section. */
  blockIds: ReadonlySet<string>
}

function titleIsUnambiguous(title: string): boolean {
  return UNAMBIGUOUS_TITLES.some((pattern) => pattern.test(title))
}

function titleIsPositional(title: string): boolean {
  return POSITIONAL_TITLES.some((pattern) => pattern.test(title))
}

/**
 * Walks the section tree in reading order, deciding per section, and marks every block a
 * flagged section owns — directly or through its children, since a "Contents" section with
 * sub-entries is all one table.
 */
export function detectFrontMatter(
  doc: SourceDoc,
  options: FrontMatterOptions = {},
): FrontMatterFlags {
  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()

  const blockPosition = new Map<string, number>()
  doc.blocks.forEach((block, index) => {
    blockPosition.set(block.id, index)
  })
  const total = doc.blocks.length
  const frontEdge = Math.max(MIN_EDGE_BLOCKS, total * (options.frontFraction ?? FRONT_FRACTION))
  const backEdge =
    total - Math.max(MIN_EDGE_BLOCKS, total * (options.backFraction ?? BACK_FRACTION))

  const blocksById = new Map(doc.blocks.map((block) => [block.id, block]))

  const markAll = (section: Section): void => {
    sectionIds.add(section.id)
    for (const id of section.blocks) blockIds.add(id)
    for (const child of section.children) markAll(child)
  }

  /** Where a section starts, as a block index — its first own block, or its first
   *  descendant's, so an empty "Contents" heading with the list under a child still lands at
   *  the right end of the document. */
  const firstBlockIndex = (section: Section): number | undefined => {
    const own = section.blocks[0]
    if (own !== undefined) return blockPosition.get(own)
    for (const child of section.children) {
      const index = firstBlockIndex(child)
      if (index !== undefined) return index
    }
    return undefined
  }

  const visit = (section: Section): void => {
    if (titleIsUnambiguous(section.title)) {
      markAll(section)
      return
    }
    if (titleIsPositional(section.title)) {
      const index = firstBlockIndex(section)
      if (index === undefined || index < frontEdge || index >= backEdge) {
        markAll(section)
        return
      }
    }
    for (const id of section.blocks) {
      const block = blocksById.get(id)
      if (
        block !== undefined &&
        blockLooksLikeMatter(block, blockPosition.get(id) ?? 0, frontEdge)
      ) {
        blockIds.add(id)
      }
    }
    for (const child of section.children) visit(child)
  }

  for (const root of doc.sections) visit(root)
  return { sectionIds, blockIds }
}

/**
 * A block that gives itself away regardless of its heading. A TOC-shaped block counts
 * anywhere — a five-page contents listing in the middle of an omnibus is still a contents
 * listing — while the copyright markers are only trusted near the front, since `ISBN` also
 * shows up in a bibliography entry and in a lesson about publishing.
 */
function blockLooksLikeMatter(block: Block, index: number, frontEdge: number): boolean {
  if (block.type === 'table' || block.type === 'code') return false
  if (looksLikeTocBlock(block.text)) return true
  return index < frontEdge && looksLikeCopyrightBlock(block.text)
}
