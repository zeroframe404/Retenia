import type { Section } from './source-doc'

/**
 * The heading-stack algorithm every parser in `src/parsers/` uses to turn a flat sequence of
 * "here's a heading at depth N" / "here's a content block" calls into `SourceDoc.sections`.
 * One copy, so PDF/DOCX/EPUB/PPTX/Markdown nest sections identically.
 */
export interface SectionTreeBuilder {
  /** Opens a new section at `level`, closing every open section at or below it first (so a
   *  level-2 heading after a level-3 one pops back out to the right ancestor). */
  pushHeading(id: string, title: string, level: number): Section
  /** Attaches a content block to whichever section is currently open. Before the first
   *  heading, that is a synthetic preamble section — created lazily, and always the first
   *  root section once it exists, since nothing can precede it. */
  attach(blockId: string): void
  readonly roots: Section[]
}

export function createSectionTree(
  makeSectionId: () => string,
  preambleTitle: string,
): SectionTreeBuilder {
  const roots: Section[] = []
  const stack: Section[] = []
  let preamble: Section | undefined

  return {
    roots,

    pushHeading(id, title, level) {
      const section: Section = { id, title, level, blocks: [], children: [] }
      while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop()
      const parent = stack.at(-1)
      if (parent) parent.children.push(section)
      else roots.push(section)
      stack.push(section)
      return section
    },

    attach(blockId) {
      if (stack.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length just checked
        stack.at(-1)!.blocks.push(blockId)
        return
      }
      if (preamble === undefined) {
        preamble = { id: makeSectionId(), title: preambleTitle, level: 0, blocks: [], children: [] }
        roots.unshift(preamble)
      }
      preamble.blocks.push(blockId)
    },
  }
}
