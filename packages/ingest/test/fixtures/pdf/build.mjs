#!/usr/bin/env node
// Regenerates the PDF fixtures used to test `src/parsers/pdf.ts`:
//   - five-pages.pdf: a born-digital document with two heading sizes (section nesting) and
//     page-specific body text (so a test can verify each block's `locator.page`).
//   - scanned-page.pdf: a single page that is nothing but a full-page image — no extractable
//     text — to exercise `needsOcr` detection.
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
