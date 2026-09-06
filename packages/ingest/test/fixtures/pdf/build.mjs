#!/usr/bin/env node
// Regenerates the PDF fixtures used to test `src/parsers/pdf.ts` and `src/chunking/`:
//   - five-pages.pdf: a born-digital document with two heading sizes (section nesting) and
//     page-specific body text (so a test can verify each block's `locator.page`).
//   - scanned-page.pdf: a single page that is nothing but a full-page image — no extractable
//     text — to exercise `needsOcr` detection.
//   - book-with-frontmatter.pdf: a book shaped like a real one — title page, copyright page,
//     a table of contents with dot leaders, two chapters, then a bibliography and an
//     alphabetical index — for `src/chunking/front-matter.ts`.
// Run with `npx tsx test/fixtures/pdf/build.mjs` from the package root whenever a fixture
// needs to change (it imports `../../src/png-encoder.ts` directly, hence `tsx` rather than
// plain `node`); the parser tests read the committed binaries, not this script.
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import PDFDocument from 'pdfkit'
import { encodeBgraAsPng } from '../../../src/png-encoder.ts'

async function writePdf(build, path) {
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4' })
  const stream = createWriteStream(path)
  doc.pipe(stream)
  build(doc)
  doc.end()
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
  console.log('wrote', path)
}

await writePdf(
  (doc) => {
    doc.addPage()
    doc.fontSize(24).text('Chapter 1: Introduction')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'This is the introduction. Spaced repetition schedules review of material at increasing ' +
          'intervals to strengthen long-term retention, and this document walks through the theory.',
      )

    doc.addPage()
    doc.fontSize(18).text('1.1 Background')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'Retrieval practice — actively recalling an answer rather than re-reading it — produces ' +
          'more durable memories than passive review, a finding replicated across many studies.',
      )

    doc.addPage()
    doc.fontSize(24).text('Chapter 2: Methods')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'The FSRS algorithm models memory as two quantities, stability and retrievability, and ' +
          'schedules the next review for whichever moment retrievability crosses a target threshold.',
      )

    doc.addPage()
    doc.fontSize(18).text('2.1 Data collection')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'Review logs record every attempt — the card, the grade given, and the interval that had ' +
          'elapsed since the previous review — and this history is what a scheduler is trained on.',
      )

    doc.addPage()
    doc.fontSize(24).text('Chapter 3: Conclusion')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        "Combining a transparent scheduler with content generated from the reader's own sources " +
          'is the central bet this whole project makes, and the rest of the document builds on it.',
      )
  },
  join(import.meta.dirname, 'five-pages.pdf'),
)

// A solid gray 100x100 PNG, stretched to fill the page — no text anywhere on it. Built with
// this package's own encoder (`png-js`, the ancient decoder pdfkit embeds images with,
// rejects some otherwise-valid minimal PNGs — a plainer image sidesteps that entirely).
const size = 100
const gray = new Uint8Array(size * size * 4)
for (let i = 0; i < size * size; i += 1) {
  gray[i * 4] = 128
  gray[i * 4 + 1] = 128
  gray[i * 4 + 2] = 128
  gray[i * 4 + 3] = 255
}
const scannedPagePng = Buffer.from(encodeBgraAsPng(gray, size, size))

await writePdf(
  (doc) => {
    doc.addPage()
    doc.image(scannedPagePng, 0, 0, { width: doc.page.width, height: doc.page.height })
  },
  join(import.meta.dirname, 'scanned-page.pdf'),
)

// A book, in the order a book actually comes in: the four pages before chapter 1 and the two
// after the last one are exactly the pages that ruin a generated outline if nobody flags them
// (`docs/spec/04-path-generation.md` §14, pitfall 6).
const CONTENTS_ENTRIES = [
  ['Prefacio', 'ix'],
  ['Capítulo 1. Qué es la memoria', '1'],
  ['1.1 La curva del olvido', '4'],
  ['1.2 Estabilidad y recuperabilidad', '9'],
  ['Capítulo 2. La práctica de recuperación', '17'],
  ['2.1 El efecto del testeo', '19'],
  ['2.2 Retroalimentación', '26'],
  ['Bibliografía', '211'],
  ['Índice analítico', '223'],
]

await writePdf(
  (doc) => {
    doc.addPage()
    doc.fontSize(28).text('Memoria y repaso espaciado')
    doc.moveDown()
    doc.fontSize(14).text('Segunda edición')

    doc.addPage()
    doc
      .fontSize(11)
      .text(
        '© 2026 Editorial Ejemplo. Todos los derechos reservados. Ninguna parte de esta ' +
          'publicación puede ser reproducida sin permiso escrito del editor.\n' +
          'ISBN 978-3-16-148410-0\nDepósito legal M-12345-2026\nImpreso en Argentina.',
      )

    doc.addPage()
    doc.fontSize(24).text('Índice')
    doc.moveDown()
    doc.fontSize(12)
    for (const [title, page] of CONTENTS_ENTRIES) {
      // Dot leaders are what makes a contents page recognisable even when the heading was
      // lost: `looksLikeTocBlock` counts lines that end in a page number.
      const dots = '.'.repeat(Math.max(4, 60 - title.length - page.length))
      doc.text(`${title} ${dots} ${page}`)
    }

    doc.addPage()
    doc.fontSize(24).text('Capítulo 1. Qué es la memoria')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'La memoria no es un archivo del que se recupera una copia intacta: es una ' +
          'reconstrucción que depende de las señales disponibles en el momento de recordar. ' +
          'Ese es el punto de partida de todo lo que sigue en este libro, y explica por qué ' +
          'releer un texto no deja casi rastro mientras que intentar recordarlo sí.',
      )

    doc.addPage()
    doc.fontSize(18).text('1.1 La curva del olvido')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'Ebbinghaus midió sobre sí mismo cuánto retenía de una lista de sílabas sin sentido ' +
          'a distintos intervalos, y obtuvo una caída rápida seguida de una meseta. La forma ' +
          'de esa curva, y no su altura, es lo que un planificador de repasos modela.',
      )

    doc.addPage()
    doc.fontSize(24).text('Capítulo 2. La práctica de recuperación')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'Recuperar activamente una respuesta produce memorias más duraderas que volver a ' +
          'leerla, un resultado replicado en decenas de estudios y el único junto con el ' +
          'espaciado que Dunlosky clasifica como de utilidad alta.',
      )

    doc.addPage()
    doc.fontSize(24).text('Bibliografía')
    doc.moveDown()
    doc
      .fontSize(12)
      .text(
        'Dunlosky, J. et al. (2013). Improving Students\u2019 Learning With Effective ' +
          'Learning Techniques. Psychological Science in the Public Interest, 14(1), 4–58.\n' +
          'Roediger, H. L. y Karpicke, J. D. (2006). Test-Enhanced Learning. Psychological ' +
          'Science, 17(3), 249–255.',
      )

    doc.addPage()
    doc.fontSize(24).text('Índice analítico')
    doc.moveDown()
    doc.fontSize(12).text('curva del olvido, 4\nespaciado, 17\nestabilidad, 9\nrecuperabilidad, 9')
  },
  join(import.meta.dirname, 'book-with-frontmatter.pdf'),
)
