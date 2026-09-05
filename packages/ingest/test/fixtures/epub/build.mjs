#!/usr/bin/env node
// Regenerates sample.epub — a small, hand-authored, spec-valid EPUB3 used to test
// `src/parsers/epub.ts`. Run with `node test/fixtures/epub/build.mjs` from the package root
// whenever the fixture needs to change; the parser test reads the committed binary, not this
// script.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:sample-fixture-0001</dc:identifier>
    <dc:title>Sample Study Guide</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
    <itemref idref="chapter2"/>
  </spine>
</package>
`

const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Table of Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter1.xhtml">Introduction</a></li>
        <li><a href="chapter2.xhtml">Advanced Topics</a></li>
      </ol>
    </nav>
  </body>
</html>
`

const chapter1Xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Introduction</title></head>
  <body>
    <h1>Introduction</h1>
    <p>This guide covers the basics of spaced repetition.</p>
    <h2>Why it works</h2>
    <p>Retrieval practice strengthens memory more than re-reading does.</p>
    <ul>
      <li>Active recall</li>
      <li>Spacing effect</li>
    </ul>
  </body>
</html>
`

const chapter2Xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Advanced Topics</title></head>
  <body>
    <h1>Advanced Topics</h1>
    <p>A diagram of the review cycle:</p>
    <p><img src="images/cover.png" alt="Review cycle diagram"/></p>
    <table>
      <tr><th>Stage</th><th>Interval</th></tr>
      <tr><td>Learning</td><td>1 day</td></tr>
      <tr><td>Review</td><td>6 days</td></tr>
    </table>
  </body>
</html>
`

// A minimal but valid 1x1 red PNG.
const coverPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const zipped = zipSync(
  {
    // Stored (not deflated) and first in the archive, per the OCF spec — real EPUB readers
    // check this; our own parser does not, but there is no reason to write an invalid file.
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(containerXml),
    'OEBPS/content.opf': strToU8(contentOpf),
    'OEBPS/nav.xhtml': strToU8(navXhtml),
    'OEBPS/chapter1.xhtml': strToU8(chapter1Xhtml),
    'OEBPS/chapter2.xhtml': strToU8(chapter2Xhtml),
    'OEBPS/images/cover.png': new Uint8Array(coverPng),
  },
  { mimetype: { level: 0 } },
)

await writeFile(join(import.meta.dirname, 'sample.epub'), zipped)
console.log('wrote', join(import.meta.dirname, 'sample.epub'))
