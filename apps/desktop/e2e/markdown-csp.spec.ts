import path from 'node:path'
import Database from 'better-sqlite3'
import { callApiWith, expect, gotoReady, screenshot, test } from './fixtures'

/**
 * Markdown, math and highlighted code under the **production** Content-Security-Policy.
 *
 * The unit tests for `MarkdownView`, `KatexInline` and `CodeBlock` run in jsdom, which enforces
 * no CSP at all, and until now no e2e test rendered any of them — which is exactly how a
 * production-only rendering break got in: `style-src` governs style attributes in *parsed
 * markup*, so KaTeX's positioning spans and Shiki's token colors were dropped in the packaged
 * app while every unit test stayed green. Both now go through React (`renderSanitizedHast`),
 * which applies styles through CSSOM, and this is the test that says so from inside a real
 * Chromium serving `app://` under the strict policy — `fixtures.ts` clears
 * `ELECTRON_RENDERER_URL`, so the dev relaxation is off, and `smoke.spec.ts` pins that the
 * policy really is the strict one.
 *
 * The content reaches the screen through a seeded review card: `memory.seedReviewDemo` writes the
 * item and the row's `fields` are then rewritten in place with the Markdown under test, because
 * the seed's own text is fixed. `review.spec.ts` opens the same database the same way.
 */

/** Inline math, display math and a fenced block — the three sinks the policy broke. The `$$`
 *  delimiters sit on their own lines: on one line `remark-math` reads them as inline math, and
 *  it is the display wrapper this test needs. */
const MARKDOWN = [
  'La retrievability es $R = e^{-t/S}$ para un intervalo $t$.',
  '',
  '$$',
  'R(t) = \\left(1 + \\frac{t}{9 \\cdot S}\\right)^{-1}',
  '$$',
  '',
  '```ts',
  'export function retrievability(elapsed: number, stability: number): number {',
  '  return (1 + elapsed / (9 * stability)) ** -1',
  '}',
  '```',
  '',
  '```mermaid',
  'graph TD; A[Repaso] --> B[Recuerdo];',
  '```',
].join('\n')

/**
 * Records every `securitypolicyviolation` the page reports, in order. Installed as an init
 * script so it is listening before the navigation that renders anything, and bound to the
 * document because the event is dispatched at the node owning the blocked resource and bubbles
 * from there.
 */
function collectViolations(): void {
  const violations: string[] = []
  ;(window as unknown as Record<string, unknown>).__cspViolations = violations
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push(event.effectiveDirective || event.violatedDirective)
  })
}

const readViolations = () =>
  ((window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []).slice()

test('renders math and highlighted code under the production CSP, with nothing blocked', async ({
  window,
  electronApp,
}) => {
  await gotoReady(window)

  const seeded = await callApiWith(window, ({ api, arg }) => api.memory.seedReviewDemo(arg), {
    count: 1,
  })
  expect(seeded.ok).toBe(true)
  const itemId = seeded.ok ? seeded.data.itemIds[0] : null
  expect(itemId).toBeTruthy()

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const db = new Database(path.join(userDataDir, 'retenia.db'))
  try {
    // The app holds the same file open; WAL lets a second connection write, and the timeout
    // covers the moment a checkpoint holds the lock.
    db.pragma('busy_timeout = 5000')
    db.prepare(
      'UPDATE knowledge_items SET fields = ?, updated_at = ?, version = version + 1 WHERE id = ?',
    ).run(JSON.stringify({ front: MARKDOWN, back: 'listo' }), Date.now(), itemId)
  } finally {
    db.close()
  }

  await window.addInitScript(collectViolations)
  await window.reload()
  await gotoReady(window)

  // The shell reports a few violations of its own before any Markdown is on screen (an inline
  // <style> element, an `eval`, a `data:` font — none of them from this pipeline). They are the
  // baseline this test measures against rather than something it can assert away from here.
  const baseline = await window.evaluate(readViolations)

  await window.getByTestId('sidebar-item-review').click()
  await expect(window.getByTestId('card-basic')).toBeVisible()

  const card = window.getByTestId('card-basic')

  /*
   * The assertion the broken build would have failed: every inline style on the card is
   * *applied*, not merely present.
   *
   * `style-src` blocks a style attribute that arrives in parsed markup — the attribute stays in
   * the DOM but its declaration is dropped, so `el.style.length` is 0 (verified against this
   * very policy by writing one through `innerHTML`). A style React set through CSSOM has a
   * non-empty declaration. That difference is precisely the `dangerouslySetInnerHTML` regression
   * this file exists to catch, and no count of violation events can see it: both paths report
   * the same `style-src-attr` directive, only one of them actually loses the styling.
   */
  const unapplied = await card.evaluate((root) =>
    [...root.querySelectorAll('[style]')]
      .filter((el) => (el.getAttribute('style') ?? '').trim() !== '')
      .filter((el) => (el as HTMLElement).style.length === 0)
      .map((el) => `${el.tagName}: ${el.getAttribute('style')}`),
  )
  expect(unapplied).toEqual([])

  // Math: KaTeX's HTML half is nested spans positioned by inline styles, so a policy that drops
  // them collapses the box. The strut is where that shows first — an empty inline-block whose
  // only size is the `height` its style carries.
  //
  // `katex-strut`, not `strut`: KaTeX 0.18 prefixed the class names its HTML half uses, and the
  // `overrides` entry in `pnpm-workspace.yaml` is what makes `rehype-katex` render with the same
  // 0.18.5 build `packages/ui` ships the stylesheet for. If the two ever split again this
  // locator finds nothing and the test fails loudly, which is the point.
  const displayMath = card.locator('.katex-display .katex').first()
  await expect(displayMath).toBeVisible()
  const mathBox = await displayMath.boundingBox()
  expect(mathBox?.height ?? 0).toBeGreaterThan(0)

  const strutHeight = await card
    .locator('.katex-display .katex .katex-strut')
    .first()
    .evaluate((strut) => Number.parseFloat(getComputedStyle(strut).height))
  expect(strutHeight).toBeGreaterThan(0)

  // Inline math renders too, and in the flow of its paragraph rather than as a display block.
  await expect(card.locator('p .katex').first()).toBeVisible()

  // Highlighting: Shiki colors every token with an inline style. A single distinct color across
  // the whole block means they were dropped and every token inherited the container's color.
  const codeBlock = card.locator('pre.shiki').first()
  await expect(codeBlock).toBeVisible()
  const colors = await codeBlock.evaluate((pre) => {
    const seen = new Set<string>()
    for (const span of pre.querySelectorAll('span')) {
      if ((span.textContent ?? '').trim() !== '') seen.add(getComputedStyle(span).color)
    }
    return [...seen]
  })
  expect(colors.length).toBeGreaterThan(1)

  /*
   * Diagrams. `MermaidView` presents the finished SVG as an `<img>` of a `data:` URL, and both
   * halves of that were production-only breaks the jsdom tests could not see:
   *
   * - Mermaid's `securityLevel: 'sandbox'` appended an `<iframe sandbox="">` and read
   *   `contentDocument.body` from the parent — `null` under the opaque origin an empty `sandbox`
   *   creates, so every diagram threw before it was drawn and this element would not exist.
   * - The previous presentation was an `about:srcdoc` iframe, which inherits this page's policy
   *   container; a Mermaid SVG keeps its whole theme in an inline `<style>`, so `style-src 'self'`
   *   dropped it. Inside an image that `<style>` is not subject to the page's CSP, which is what
   *   `naturalWidth > 0` and a non-uniform painted diagram below actually prove.
   *
   * The label assertion is the third: `htmlLabels: false` (see `loadMermaid`) makes Mermaid draw
   * node captions as SVG `<tspan>`s instead of HTML inside a `<foreignObject>`. That is a security
   * decision — the `<foreignObject>` path writes the diagram source into the layout document with
   * `innerHTML` — and it is also the only form that survives here, since an SVG loaded as an image
   * renders no embedded HTML.
   */
  const diagram = card.getByAltText('Diagram')
  await expect(diagram).toBeVisible()
  const painted = await diagram.evaluate((img) => {
    const image = img as HTMLImageElement
    const svg = decodeURIComponent(image.src).replace('data:image/svg+xml;charset=utf-8,', '')

    // Painting it is the only way to ask whether the theme inside the SVG was honoured: the
    // <style> lives in the image resource, so nothing about the element in this document reports
    // on it. A diagram that lost its theme is flat — boxes and text in one inherited colour.
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context?.drawImage(image, 0, 0)
    const colors = new Set<string>()
    if (context && canvas.width > 0 && canvas.height > 0) {
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < data.length; i += 4) {
        colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
      }
    }
    return { svg, naturalWidth: image.naturalWidth, colors: colors.size }
  })

  expect(painted.svg).toContain('<svg')
  expect(painted.svg).toContain('Recuerdo')
  // The theme Mermaid keeps inside the SVG made it into the artifact…
  expect(painted.svg).toContain('<style')
  // …the image decoded…
  expect(painted.naturalWidth).toBeGreaterThan(0)
  // …and it was drawn with more than one colour, so that <style> was applied.
  expect(painted.colors).toBeGreaterThan(1)

  await screenshot(window, 'markdown-csp')

  /*
   * Rendering the card adds no violated directive beyond `style-src-attr`.
   *
   * Chromium *reports* `style-src-attr` for a CSSOM write to `element.style` while still
   * applying it — it is a report, not a block, and the `unapplied` assertion above is what
   * proves nothing was actually dropped. Everything else is a real block: an `img-src` here
   * would mean a remote image slipped into a lesson, a `script-src` that some sink started
   * executing content.
   */
  const added = (await window.evaluate(readViolations)).slice(baseline.length)
  const notStyleAttr = added.filter((directive) => directive !== 'style-src-attr').sort()

  /*
   * Exactly two `style-src-elem` reports, and they are Mermaid's, not this pipeline's.
   *
   * Laying a diagram out means measuring real text, so Mermaid writes two `<style>` elements
   * while it works: its global CSS into `document.head`, and the diagram's theme into the SVG it
   * is building inside the off-screen container `MermaidView` hands it. Both are blocked here and
   * neither matters — the container is thrown away, and what reaches the screen is the
   * *serialized* SVG, whose own `<style>` is applied by the image decoder, as the colour count
   * above proves. They are Mermaid's own CSS, not content: under `htmlLabels: false` the diagram
   * source reaches that container only as text nodes.
   *
   * The count is pinned rather than the directive allowed: a `<style>` element appearing from
   * anywhere else in the Markdown pipeline is the regression this file exists to catch, and it
   * would report the same directive.
   */
  expect(notStyleAttr).toEqual(['style-src-elem', 'style-src-elem'])
})
