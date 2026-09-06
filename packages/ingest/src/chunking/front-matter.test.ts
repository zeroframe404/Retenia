import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeSourceDoc, paragraph } from '../../test/make-source-doc'
import { parsePdf } from '../parsers/pdf'
import type { Section } from '../source-doc'
import { detectFrontMatter, looksLikeCopyrightBlock, looksLikeTocBlock } from './front-matter'

const BOOK = join(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'pdf',
  'book-with-frontmatter.pdf',
)

describe('looksLikeTocBlock', () => {
  it('recognizes a contents page by its dot leaders', () => {
    expect(
      looksLikeTocBlock(
        [
          'Prefacio .............. ix',
          'Capítulo 1. Qué es la memoria ......... 1',
          '1.1 La curva del olvido ......... 4',
          'Bibliografía ......... 211',
        ].join('\n'),
      ),
    ).toBe(true)
  })

  it('recognizes one without leaders, on the page numbers alone', () => {
    expect(
      looksLikeTocBlock(
        ['Introducción    1', 'Métodos    12', 'Resultados    31', 'Discusión    48'].join('\n'),
      ),
    ).toBe(true)
  })

  it('does not mistake a short numbered list for one', () => {
    expect(looksLikeTocBlock('Paso 1\nPaso 2\nPaso 3')).toBe(false)
  })

  it('does not mistake prose that happens to end in a number for one', () => {
    expect(
      looksLikeTocBlock(
        [
          'El experimento se repitió durante 2019',
          'y las condiciones fueron estables.',
          'Los sujetos completaron la tarea en menos de una hora.',
          'Ninguno abandonó el estudio.',
        ].join('\n'),
      ),
    ).toBe(false)
  })
})

describe('looksLikeCopyrightBlock', () => {
  it.each([
    '© 2026 Editorial Ejemplo',
    'ISBN 978-3-16-148410-0',
    'All rights reserved.',
    'Todos los derechos reservados',
  ])('recognizes %s', (text) => {
    expect(looksLikeCopyrightBlock(text)).toBe(true)
  })

  it('does not fire on ordinary prose', () => {
    expect(looksLikeCopyrightBlock('La memoria es una reconstrucción.')).toBe(false)
  })
})

describe('detectFrontMatter', () => {
  it('flags the front and back matter of a real book', async () => {
    let id = 0
    const bytes = new Uint8Array(await readFile(BOOK))
    const doc = await parsePdf(
      { bytes, fallbackTitle: 'Memoria y repaso espaciado' },
      {
        id: () => {
          id += 1
          return `id-${id}`
        },
        putAsset: async () => ({
          id: 'a',
          blobSha256: '0'.repeat(64),
          mime: 'image/png',
          kind: 'image' as const,
        }),
      },
    )

    const flags = detectFrontMatter(doc)
    const flaggedTitles = collectTitles(doc.sections, flags.sectionIds)

    expect(flaggedTitles.sort()).toEqual(['Bibliografía', 'Índice', 'Índice analítico'])
    // The copyright page has no heading of its own — it is caught on its own shape.
    const copyright = doc.blocks.find((block) => block.text.includes('ISBN'))
    expect(flags.blockIds.has(copyright?.id as string)).toBe(true)
    // …and the chapters are not touched.
    const chapter = doc.blocks.find((block) => block.text.startsWith('La memoria no es'))
    expect(flags.blockIds.has(chapter?.id as string)).toBe(false)
  })

  it('flags an unambiguous title wherever it appears', () => {
    const doc = makeSourceDoc({
      sections: [
        { title: 'Capítulo 1', blocks: [{ text: paragraph(200) }] },
        { title: 'Table of contents', blocks: [{ text: paragraph(200) }] },
        { title: 'Capítulo 2', blocks: [{ text: paragraph(200) }] },
      ],
    })

    const flags = detectFrontMatter(doc)
    expect(collectTitles(doc.sections, flags.sectionIds)).toEqual(['Table of contents'])
  })

  it('flags a generic title at the end of the document but not in the middle of it', () => {
    const chapters = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        title: `Capítulo ${from + index}`,
        blocks: [{ text: paragraph(200) }],
      }))
    const references = { title: 'Referencias', blocks: [{ text: paragraph(200) }] }

    // Seven chapters on either side: far enough from both ends that the edge rule cannot
    // reach it, so "Referencias" here is a lesson about citing sources, not a bibliography.
    const middle = makeSourceDoc({ sections: [...chapters(1, 7), references, ...chapters(8, 7)] })
    expect(collectTitles(middle.sections, detectFrontMatter(middle).sectionIds)).toEqual([])

    const end = makeSourceDoc({ sections: [...chapters(1, 14), references] })
    expect(collectTitles(end.sections, detectFrontMatter(end).sectionIds)).toEqual(['Referencias'])

    const front = makeSourceDoc({ sections: [references, ...chapters(1, 14)] })
    expect(collectTitles(front.sections, detectFrontMatter(front).sectionIds)).toEqual([
      'Referencias',
    ])
  })

  it('takes a flagged section’s children with it', () => {
    const doc = makeSourceDoc({
      sections: [
        {
          title: 'Índice',
          blocks: [{ text: paragraph(50) }],
          children: [{ title: 'Parte I', blocks: [{ text: paragraph(50) }] }],
        },
      ],
    })

    const flags = detectFrontMatter(doc)
    expect(flags.blockIds.size).toBe(2)
  })
})

function collectTitles(sections: readonly Section[], ids: ReadonlySet<string>): string[] {
  const titles: string[] = []
  const walk = (section: Section): void => {
    if (ids.has(section.id)) titles.push(section.title)
    for (const child of section.children) walk(child)
  }
  for (const section of sections) walk(section)
  return titles
}
