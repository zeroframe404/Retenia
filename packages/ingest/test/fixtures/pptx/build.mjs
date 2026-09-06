#!/usr/bin/env node
// Regenerates sample.pptx — a small, hand-authored, spec-valid PPTX used to test
// `src/parsers/pptx.ts`. Run with `node test/fixtures/pptx/build.mjs` from the package root
// whenever the fixture needs to change; the parser test reads the committed binary, not this
// script.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
</Types>
`

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>
`

const presentationXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
    <p:sldId id="257" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>
`

const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>
`

function slideXml(shapes) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      ${shapes}
    </p:spTree>
  </p:cSld>
</p:sld>
`
}

function titleShape(id, text) {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
    <p:spPr/>
    <p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>
  </p:sp>`
}

function bodyShape(id, paragraphs) {
  const body = paragraphs.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Content"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
    <p:spPr/>
    <p:txBody><a:bodyPr/>${body}</p:txBody>
  </p:sp>`
}

const picShape = `<p:pic>
    <p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
    <p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
    <p:spPr/>
  </p:pic>`

const slide1Xml = slideXml(
  [
    titleShape(2, 'Cell Biology'),
    bodyShape(3, ['Cells are the basic building blocks of life.', 'Mitochondria produce energy.']),
  ].join('\n      '),
)

const slide2Xml = slideXml([titleShape(2, 'Diagrams'), picShape].join('\n      '))

const slide1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>
`

const slide2Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>
`

const notesSlide1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:p><a:r><a:t>Remember to mention the cell membrane analogy.</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>
`

// A minimal but valid 1x1 blue PNG.
const imagePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const zipped = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rootRels),
  'ppt/presentation.xml': strToU8(presentationXml),
  'ppt/_rels/presentation.xml.rels': strToU8(presentationRels),
  'ppt/slides/slide1.xml': strToU8(slide1Xml),
  'ppt/slides/slide2.xml': strToU8(slide2Xml),
  'ppt/slides/_rels/slide1.xml.rels': strToU8(slide1Rels),
  'ppt/slides/_rels/slide2.xml.rels': strToU8(slide2Rels),
  'ppt/notesSlides/notesSlide1.xml': strToU8(notesSlide1Xml),
  'ppt/media/image1.png': new Uint8Array(imagePng),
})

await writeFile(join(import.meta.dirname, 'sample.pptx'), zipped)
console.log('wrote', join(import.meta.dirname, 'sample.pptx'))
