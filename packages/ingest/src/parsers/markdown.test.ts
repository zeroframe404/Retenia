import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFakeParseContext } from '../../test/fake-parse-context'
import { parseMarkdown } from './markdown'

const fixturesDir = join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'markdown')

describe('parseMarkdown', () => {
  it('builds a section tree from headings and keeps frontmatter in meta', async () => {
    const bytes = await readFile(join(fixturesDir, 'sample.md'))
    const ctx = createFakeParseContext()

    const doc = await parseMarkdown({ bytes, fallbackTitle: 'sample.md' }, ctx)

    expect(doc.kind).toBe('markdown')
    // Frontmatter's own `title` wins over the fallback filename and over the first heading.
    expect(doc.title).toBe('Sample Study Notes')
    expect(doc.meta.frontmatter).toEqual({
      title: 'Sample Study Notes',
      tags: ['biology', 'cells'],
    })
    expect(doc.meta.warnings).toEqual([])
    expect(doc.language).toBe('en')

    expect(doc.sections).toHaveLength(1)
    const cellBiology = doc.sections[0]
    expect(cellBiology?.title).toBe('Cell Biology')
    expect(cellBiology?.level).toBe(1)
    expect(cellBiology?.children.map((s) => s.title)).toEqual(['Cell Structure', 'Cell Division'])

    const cellStructure = cellBiology?.children[0]
    expect(cellStructure?.children.map((s) => s.title)).toEqual(['Example'])

    const blockById = new Map(doc.blocks.map((b) => [b.id, b]))
    const listBlock = doc.blocks.find((b) => b.type === 'list')
    expect(listBlock?.text).toContain('Nucleus: holds the DNA')
    expect(listBlock?.html).toContain('- Nucleus')

    const tableBlock = doc.blocks.find((b) => b.type === 'table')
    expect(tableBlock?.html).toContain('| Organelle | Function |')

    const codeBlock = doc.blocks.find((b) => b.type === 'code')
    expect(codeBlock?.text).toContain('def is_alive(cell):')

    // Every block referenced by a section actually exists in the flat `blocks` array.
    for (const section of [cellBiology, cellStructure, cellBiology?.children[1]]) {
      for (const id of section?.blocks ?? []) {
        expect(blockById.has(id)).toBe(true)
      }
    }

    expect(doc).toMatchSnapshot()
  })

  it('has no frontmatter section for a .txt-style parse', async () => {
    const ctx = createFakeParseContext()
    const doc = await parseMarkdown(
      {
        bytes: new TextEncoder().encode('Just a plain paragraph of English text, nothing more.'),
        fallbackTitle: 'notes.txt',
      },
      ctx,
      { frontmatter: false },
    )

    expect(doc.kind).toBe('text')
    expect(doc.meta.frontmatter).toBeUndefined()
    expect(doc.sections).toHaveLength(1)
    expect(doc.sections[0]?.title).toBe('notes.txt')
    expect(doc.title).toBe('notes.txt')
  })
})
