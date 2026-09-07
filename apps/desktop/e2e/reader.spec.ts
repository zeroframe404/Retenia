import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { callApiWith, expect, gotoReady, screenshot, test } from './fixtures'

const here = path.dirname(fileURLToPath(import.meta.url))
/** The same fixture `packages/readers`' own PDF tests and stories use — a real, five-page
 *  PDF whose page 1 reads "Chapter 1: Introduction" (pdf.js's own text extraction, not a
 *  mock), so this test drives the genuine pdf.js/`TextLayer` pipeline end to end. */
const FIXTURE_PDF = path.join(here, '../../../packages/readers/test/fixtures/pdf/five-pages.pdf')

/**
 * The PDF reader, end to end (sub-phase 6.6, `docs/spec/08-ux.md` §2 "Biblioteca de
 * fuentes"): import a real PDF, open it in the reader, highlight real pdf.js-rendered text,
 * create a card from it, and see that card in the review queue.
 *
 * Everything below the IPC boundary — annotation persistence, the CFI/locator round trip,
 * the composer's field wiring — is unit- and RTL-tested elsewhere with fakes; what only a
 * real launch proves is that a genuine text selection over pdf.js's own `TextLayer` reaches
 * `PdfReader`'s `selectionchange` handler, that the selection toolbar's "Crear tarjeta"
 * really persists an annotation and a card through main, and that the card it creates is
 * due today.
 */
test('opens a PDF, highlights real text, creates a card, and it appears in review', async ({
  window,
}) => {
  await gotoReady(window)

  const bytes = await readFile(FIXTURE_PDF)
  const imported = await callApiWith(
    window,
    ({ api, arg }) => api.library.addSourceFromFiles(arg),
    { files: [{ name: 'five-pages.pdf', bytes: new Uint8Array(bytes) }] },
  )
  expect(imported.ok).toBe(true)
  if (!imported.ok) return
  const sourceId = imported.data.sources[0]?.id
  expect(sourceId).toBeDefined()
  if (sourceId === undefined) return

  // The import happened through a raw IPC call, not the renderer's own mutation hook, so
  // nothing told the already-mounted `library.listSources` query to refetch — the same reason
  // `review.spec.ts`'s demo-seed test reloads before looking for what it just seeded.
  await window.reload()
  await gotoReady(window)

  await window.getByTestId('sidebar-item-library').click()
  await expect(window.getByTestId('screen-library')).toBeVisible()

  // The reader needs nothing the ingest-parse job produces — it renders the source's own file
  // directly — so it is the default tab the moment the source exists, parsed or not
  // (`source-detail.tsx`), and this test never has to wait on that job at all.
  await window.getByTestId(`source-card-${sourceId}`).getByRole('button').first().click()
  await expect(window.getByTestId('pdf-text-layer-1')).toBeVisible()

  // A real text selection over pdf.js's own rendered spans — the same mechanism a mouse drag
  // produces, driven through the Selection API for a selector that does not depend on exact
  // glyph layout. `PdfReader` listens for `selectionchange` on `document`
  // (`pdf-reader.tsx`), which a real browser fires for a programmatic selection change too.
  await window.evaluate(() => {
    const container = document.querySelector('[data-testid="pdf-text-layer-1"]')
    if (!container) throw new Error('pdf text layer not found')
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (!node.textContent?.includes('Introduction')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    throw new Error('"Introduction" not found in the rendered page text')
  })

  const selectionToolbar = window.getByRole('toolbar', { name: 'Resaltar' })
  await expect(selectionToolbar).toBeVisible()
  await selectionToolbar.getByRole('button', { name: 'Crear tarjeta' }).click()

  const back = window.getByTestId('card-composer-back')
  await expect(back).toBeVisible()
  await expect(back).toHaveValue(/Introduction/)
  await window.getByTestId('card-composer-front').fill('¿Qué se explica en la introducción?')
  await screenshot(window, 'reader-card-composer')

  await window.getByTestId('card-composer-submit').click()
  await expect(window.getByTestId('card-composer-front')).not.toBeVisible()

  // The card `library.createCardFromAnnotation` writes is due immediately (`due: new Date()`
  // in `main/library/service.ts`) and this profile has no other due card, so it is the
  // review queue's very next — and its own question is on screen before any reveal.
  await window.getByTestId('sidebar-item-review').click()
  await expect(window.getByTestId('screen-review')).toBeVisible()
  await expect(window.getByTestId('card-reveal')).toBeVisible()
  await expect(window.getByText('¿Qué se explica en la introducción?')).toBeVisible()
  await screenshot(window, 'reader-card-in-review')
})
